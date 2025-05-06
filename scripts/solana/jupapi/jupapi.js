const { Transaction, VersionedTransaction, sendAndConfirmTransaction, ComputeBudgetProgram, SystemProgram, PublicKey, Keypair } = require('@solana/web3.js');
const { NATIVE_MINT, transfer, createTransferInstruction, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const axios = require('axios');
const { connection, bot, jitoConnection, fetchTokenAccountData, getRandomTipAccount } = require('./config');
const base58 = require("bs58");
const ethers = require("ethers");
const baseDao = require("../utils/mysqlsol");
const utils = require("../utils/utils");
const redis = require("../utils/redis");
const lanutils = require("../utils/lan/lanutils");
const okxwebapi = require("./okxwebapi");
const { JitoJsonRpcClient } = require('./JitoJsonRpcClient');

async function jupSwap(address, inputMint, outputMint, amount, order, from = "api") {
    console.log("jupSwap", address, inputMint, outputMint, amount, order, from);
    // Handle SOL address normalization
    if (inputMint === "11111111111111111111111111111111") {
        inputMint = NATIVE_MINT.toBase58();
    }
    if (outputMint === "11111111111111111111111111111111") {
        outputMint = NATIVE_MINT.toBase58();
    }
    // Load user information and configuration
    let appmembers = await baseDao.syncQuery("SELECT wallet.secretkey,member.* FROM `appwalletuser` wallet LEFT JOIN appmember member ON member.tg_id = wallet.tg_id WHERE address = ?",
        [address]);
    let member = appmembers[0];
    const owner = Keypair.fromSecretKey(base58.default.decode(utils.decrypt(member.secretkey)));
    let mode = member.mode;
    let slippage = member.qmode_slip; // Slippage
    if (mode == 1) {
        slippage = member.jmode_slip; // Slippage
    }
    let botSwapFeeRatio = 0.01;
    let solprice = await redis.get("solprice");

    // Notify the user that the transaction has started
    if (order) {
        await bot.api.sendMessage(member.tg_id, "The order has triggered the specified price transaction and is being executed..");
    } else {
        await bot.api.sendMessage(member.tg_id, "Transaction is being executed..");
    }

    // Set priority fee
    const isInputSol = inputMint === NATIVE_MINT.toBase58();
    let priorityFeeInSol = 0;
    if (isInputSol) {
        priorityFeeInSol = Number(member.buygas) * 1e9;
    }
    const isOutputSol = outputMint === NATIVE_MINT.toBase58();
    if (isOutputSol) {
        priorityFeeInSol = Number(member.sellgas) * 1e9;
    }
    priorityFeeInSol = priorityFeeInSol.toFixed(0);

    try {
        // Get Jupiter quote
        const quoteConfig = {
            method: 'get',
            url: `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100}&platformFeeBps=${100}`,
            headers: {
                'Accept': 'application/json'
            }
        };
        const quoteResponse = await axios.request(quoteConfig);
        if (!quoteResponse.data || quoteResponse.data.error) {
            await bot.api.sendMessage(member.tg_id, "Failed to get transaction quote");
            return null;
        }
        console.log("swapResponse", quoteResponse.data);
        // Execute swap transaction - use the same API endpoint and parameter format as the example code
        const swapResponse = await axios.post('https://lite-api.jup.ag/swap/v1/swap', {
            quoteResponse: quoteResponse.data,
            userPublicKey: owner.publicKey.toString(),
            feeAccount: "7N5mcbwqrExV3zALyUDDUTGoAB7gkRsgwdMcY6D3cd3R",
            prioritizationFeeLamports: {
                priorityLevelWithMaxLamports: {
                    maxLamports: 10000000,
                    priorityLevel: "veryHigh"
                }
            },
            dynamicComputeUnitLimit: true
        });

        console.log("swapResponse", swapResponse.data);
        if (!swapResponse.data || !swapResponse.data.swapTransaction) {
            await bot.api.sendMessage(member.tg_id, "Failed to create transaction");
            return null;
        }

        // Decode transaction
        const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
        let transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        // Calculate transaction fee
        let fee = 0;
        if (isInputSol) {
            fee = (amount * Number(botSwapFeeRatio)).toFixed(0);
        } else {
            let prices = await okxwebapi.getTokenPrice(inputMint);
            if (prices.length > 0) {
                let price = prices[0].price;
                let tokenAmount = ethers.utils.formatUnits(amount, prices[0].decimal);
                fee = ((Number(tokenAmount) * price * 1e9) / solprice * Number(botSwapFeeRatio)).toFixed(0);
            }
        }
        // If anti-sandwich mode, add tip
        if (Number(mode) === 1) {
            console.log("Anti-sandwich mode");
        }

        // Choose connection
        let myConnection = connection;
        if (Number(mode) === 1) {
            myConnection = jitoConnection;
        }

        try {
            let txId = '';

            // Anti-sandwich mode handling
            if (Number(mode) === 1) {
                console.log("Anti-sandwich mode");
                // Get the latest block hash
                const recentBlockHash = await connection.getLatestBlockhash();
                transaction.sign([owner]);

                // Create tip transaction
                const serializedTransaction = transaction.serialize();
                const base58Transaction = base58.default.encode(serializedTransaction);

                // Get tip amount
                let floor = await axios.get("https://bundles.jito.wtf/api/v1/bundles/tip_floor");
                let jitoset = await redis.get(member.tg_id+"jitoset");
                if (jitoset == null) {
                    jitoset = 2;
                }

                let lamports = Number(floor.data[0].landed_tips_75th_percentile) * 1e9;
                if (jitoset == 1) {
                    lamports = Number(floor.data[0].landed_tips_25th_percentile) * 1e9;
                } else if (jitoset == 2) {
                    lamports = Number(floor.data[0].landed_tips_75th_percentile) * 1e9;
                } else if (jitoset == 3) {
                    lamports = Number(floor.data[0].landed_tips_95th_percentile) * 1e9;
                } else if (jitoset == 4) {
                    lamports = Number(floor.data[0].landed_tips_99th_percentile) * 1e9;
                } else {
                    lamports = Number(jitoset) * 1e9;
                }

                lamports = lamports.toFixed(0);
                console.log("Tip amount:", lamports);

                // Create tip transfer instruction
                const transferInstruction = SystemProgram.transfer({
                    fromPubkey: owner.publicKey, // Payer address
                    toPubkey: new PublicKey(getRandomTipAccount()), // Recipient address
                    lamports: lamports, // Transfer amount
                });

                // Create tip transaction
                const tipTransaction = new Transaction().add(transferInstruction);
                tipTransaction.recentBlockhash = recentBlockHash.blockhash;
                tipTransaction.feePayer = owner.publicKey;
                tipTransaction.sign(owner);

                // Serialize tip transaction
                const serializedTipTransaction = tipTransaction.serialize();
                const base58TipTransaction = base58.default.encode(serializedTipTransaction);

                // Use JitoJsonRpcClient to send transaction bundle
                const jitoClient = new JitoJsonRpcClient('https://mainnet.block-engine.jito.wtf/api/v1', "");
                const result = await jitoClient.sendBundle([[base58Transaction, base58TipTransaction]]);
                txId = result.result;
            } else {
                transaction.sign([owner]);
                txId = await myConnection.sendRawTransaction(transaction.serialize(), {
                    skipPreflight: true,
                    preflightCommitment: 'processed'
                });
            }

            // Calculate transaction data to record
            const type = isInputSol ? "buy" : "sell";
            const inamount = isInputSol ? 0 : amount;
            const recordAmount = isInputSol ? amount : 0;

            // Send transaction confirmation message
            const message = await bot.api.sendMessage(member.tg_id,
                "✅Broadcasted and being processed on-chain!" + (Number(mode) == 0 ? "[" + await lanutils.lan("djck", member.tg_id) + "](https://solscan.io/tx/" + txId + ")" : "") + " \n",
                {
                    parse_mode: "Markdown",
                    disable_web_page_preview: true
                }
            );
            // Insert transaction record
            await baseDao.syncQuery(
                "INSERT INTO `appswaporder` (`address`, `token`, `intoken`, `amount`, `hash`, `time`, `type`, `dex`, `upgas`, `inamount`, `price`, `fee`, `check`, `chatid`, `messageId`, `from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [
                    owner.publicKey.toBase58(),
                    isInputSol ? outputMint : "11111111111111111111111111111111",
                    isInputSol ? "11111111111111111111111111111111" : inputMint,
                    isInputSol ? amount : 0,
                    txId,
                    new Date(),
                    type,
                    "jupiter",
                    priorityFeeInSol,
                    inamount,
                    0,
                    fee / 1e9,
                    1,
                    message.chat.id,
                    message.message_id,
                    from
                ]
            );
            console.log("Transaction hash", txId);
            return txId;
        } catch (e) {
            console.error("Transaction execution failed:", e);
            await bot.api.sendMessage(member.tg_id, "Transaction failed");
            return null;
        }
    } catch (error) {
        console.error("Jupiter API call failed:", error);
        await bot.api.sendMessage(member.tg_id, "An error occurred during the transaction");
        return null;
    }
}

// Advanced trading functionality
async function advanceJupSwap(address, inputMint, outputMint, amount, percent, from = "api") {
    // Handle SOL address normalization
    if (inputMint === "11111111111111111111111111111111") {
        inputMint = NATIVE_MINT.toBase58();
    }
    if (outputMint === "11111111111111111111111111111111") {
        outputMint = NATIVE_MINT.toBase58();
    }

    // Load user information and configuration
    let appmembers = await baseDao.syncQuery("SELECT wallet.secretkey,member.* FROM `appwalletuser` wallet LEFT JOIN appmember member ON member.tg_id = wallet.tg_id WHERE address = ?",
        [address]);
    let member = appmembers[0];
    const owner = Keypair.fromSecretKey(base58.default.decode(utils.decrypt(member.secretkey)));
    let mode = member.mode;
    let slippage = member.qmode_slip; // Slippage
    if (mode == 1) {
        slippage = member.jmode_slip; // Slippage
    }
    let botSwapFeeRatio = await redis.get("botSwapFeeRatio");
    let solprice = await redis.get("solprice");

    await bot.api.sendMessage(member.tg_id, "Advanced transaction is being executed..");
    console.log("slippage",slippage)

    // Set priority fee
    const isInputSol = inputMint === NATIVE_MINT.toBase58();
    let priorityFeeInSol = 0;
    if (isInputSol) {
        priorityFeeInSol = Number(member.buygas) * 1e9;
    }
    const isOutputSol = outputMint === NATIVE_MINT.toBase58();
    if (isOutputSol) {
        priorityFeeInSol = Number(member.sellgas) * 1e9;
    }
    priorityFeeInSol = priorityFeeInSol.toFixed(0);

    try {
        let txId = '';

        const quoteConfig = {
            method: 'get',
            url: `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100}&platformFeeBps=100`,
            headers: {
                'Accept': 'application/json'
            }
        };
        const quoteResponse = await axios.request(quoteConfig);

        if (!quoteResponse.data || quoteResponse.data.error) {
            await bot.api.sendMessage(member.tg_id, "Failed to get transaction quote");
            return null;
        }
        console.log("swapResponse", quoteResponse.data);
        // Execute swap transaction - use the same API endpoint and parameter format as the example code
        const swapResponse = await axios.post('https://lite-api.jup.ag/swap/v1/swap', {
            quoteResponse: quoteResponse.data,
            userPublicKey: owner.publicKey.toString(),
            prioritizationFeeLamports: {
                priorityLevelWithMaxLamports: {
                    maxLamports: 10000000,
                    priorityLevel: "veryHigh"
                }
            },
            dynamicComputeUnitLimit: true,
            feeAccount: "7N5mcbwqrExV3zALyUDDUTGoAB7gkRsgwdMcY6D3cd3R",
        });

        console.log("swapResponse", swapResponse.data);
        if (!swapResponse.data || !swapResponse.data.swapTransaction) {
            await bot.api.sendMessage(member.tg_id, "Failed to create transaction");
            return null;
        }

        // Decode transaction
        const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
        let transaction = VersionedTransaction.deserialize(swapTransactionBuf);

        // Calculate transaction fee
        let fee = 0;
        if (isInputSol) {
            fee = (amount * Number(botSwapFeeRatio)).toFixed(0);
        } else {
            let prices = await okxwebapi.getTokenPrice(inputMint);
            if (prices.length > 0) {
                let price = prices[0].price;
                let tokenAmount = ethers.utils.formatUnits(amount, prices[0].decimal);
                fee = ((Number(tokenAmount) * price * 1e9) / solprice * Number(botSwapFeeRatio)).toFixed(0);
            }
        }
        // Choose connection
        let myConnection = connection;
        if (Number(mode) === 1) {
            myConnection = jitoConnection;
        }

        // If anti-sandwich mode, add tip
        if (Number(mode) === 1) {
            console.log("Anti-sandwich mode");
            // Get the latest block hash
            const recentBlockHash = await connection.getLatestBlockhash();
            transaction.sign([owner]);

            // Create tip transaction
            const serializedTransaction = transaction.serialize();
            const base58Transaction = base58.default.encode(serializedTransaction);

            // Get tip amount
            let floor = await axios.get("https://bundles.jito.wtf/api/v1/bundles/tip_floor");
            let jitoset = await redis.get(member.tg_id+"jitoset");
            if (jitoset == null) {
                jitoset = 2;
            }

            let lamports = Number(floor.data[0].landed_tips_75th_percentile) * 1e9;
            if (jitoset == 1) {
                lamports = Number(floor.data[0].landed_tips_25th_percentile) * 1e9;
            } else if (jitoset == 2) {
                lamports = Number(floor.data[0].landed_tips_75th_percentile) * 1e9;
            } else if (jitoset == 3) {
                lamports = Number(floor.data[0].landed_tips_95th_percentile) * 1e9;
            } else if (jitoset == 4) {
                lamports = Number(floor.data[0].landed_tips_99th_percentile) * 1e9;
            } else {
                lamports = Number(jitoset) * 1e9;
            }

            lamports = lamports.toFixed(0);
            console.log("Tip amount:", lamports);

            // Create tip transfer instruction
            const transferInstruction = SystemProgram.transfer({
                fromPubkey: owner.publicKey, // Payer address
                toPubkey: new PublicKey(getRandomTipAccount()), // Recipient address
                lamports: lamports, // Transfer amount
            });

            // Create tip transaction
            const tipTransaction = new Transaction().add(transferInstruction);
            tipTransaction.recentBlockhash = recentBlockHash.blockhash;
            tipTransaction.feePayer = owner.publicKey;
            tipTransaction.sign(owner);

            // Serialize tip transaction
            const serializedTipTransaction = tipTransaction.serialize();
            const base58TipTransaction = base58.default.encode(serializedTipTransaction);

            // Use JitoJsonRpcClient to send transaction bundle
            const jitoClient = new JitoJsonRpcClient('https://mainnet.block-engine.jito.wtf/api/v1', "");
            const result = await jitoClient.sendBundle([[base58Transaction, base58TipTransaction]]);
            txId = result.result;
        } else {
            // Then send the main transaction
            transaction.sign([owner]);
            txId = await myConnection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: true,
                preflightCommitment: 'processed'
            });
        }

        // Handle buy-type transaction
        if (isInputSol) {
            // Handle buy-type transaction
            let normalizedAmount = amount / 1e9; // Convert to readable format
            let inamount = 0;
            let price = 0;

            // Send transaction confirmation message
            const message = await bot.api.sendMessage(member.tg_id,
                "✅Broadcasted and being processed on-chain!" + (Number(mode) == 0 ? "[" + await lanutils.lan("djck", member.tg_id) + "](https://solscan.io/tx/" + txId + ")" : "") + " \n",
                {
                    parse_mode: "Markdown",
                    disable_web_page_preview: true
                }
            );

            // Insert transaction record with percent parameters
            if (percent) {
                // Check and set default values, consistent with raydiumhelp
                if (percent.stoplossamountpercent == null) {
                    percent.stoplossamountpercent = 0;
                }
                if (percent.pricemaxcheck == null) {
                    percent.pricemaxcheck = 0;
                }
                if (percent.stopmaxnum == null) {
                    percent.stopmaxnum = 3;
                }

                // Insert transaction record with percent parameters
                await baseDao.syncQuery(
                    "INSERT INTO `appswaporder` (`address`, `token`, `intoken`, `amount`, `hash`, `time`, `type`, `dex`, `upgas`, `inamount`, `price`, `fee`, `check`, `chatid`, `messageId`, `stopearnpercent`, `stoplosspercen`, `amountpercent`, `stopmode`, `stoplossamountpercent`, `pricemaxcheck`, `stopmaxnum`, `from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    [
                        owner.publicKey.toBase58(),
                        outputMint,
                        "11111111111111111111111111111111",
                        normalizedAmount,
                        txId,
                        new Date(),
                        type,
                        "jupiter",
                        priorityFeeInSol,
                        inamount,
                        price,
                        fee / 1e9,
                        1,
                        message.chat.id,
                        message.message_id,
                        percent.stopearnpercent,
                        percent.stoplosspercent,
                        percent.amountpercent,
                        "1",
                        percent.stoplossamountpercent,
                        percent.pricemaxcheck,
                        percent.stopmaxnum,
                        from
                    ]
                );
            } else {
                // Insert regular transaction record
                await baseDao.syncQuery(
                    "INSERT INTO `appswaporder` (`address`, `token`, `intoken`, `amount`, `hash`, `time`, `type`, `dex`, `upgas`, `inamount`, `price`, `fee`, `check`, `chatid`, `messageId`, `from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    [
                        owner.publicKey.toBase58(),
                        outputMint,
                        "11111111111111111111111111111111",
                        normalizedAmount,
                        txId,
                        new Date(),
                        type,
                        "jupiter",
                        priorityFeeInSol,
                        inamount,
                        price,
                        fee / 1e9,
                        1,
                        message.chat.id,
                        message.message_id,
                        from
                    ]
                );
            }

            console.log("Transaction hash", txId);
            return txId;
        }

        // Sell-type transaction handling logic (if needed) can be added here

    } catch (error) {
        console.error("Jupiter advanced transaction failed:", error);
        await bot.api.sendMessage(member.tg_id, "An error occurred during the transaction");
        return null;
    }
}

/**
 * Gets detailed token price information from Jupiter API
 * @param {string} tokenMint - The token mint address
 * @returns {Promise<Object>} - Price data for the token
 */
async function getTokenPrice(tokenMint) {
    try {
        // Normalize SOL address
        if (tokenMint === "11111111111111111111111111111111") {
            tokenMint = NATIVE_MINT.toBase58();
        }
        
        // Fetch price data from Jupiter API
        const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenMint}`);
        
        if (response.data && response.data.data && response.data.data[tokenMint]) {
            const priceData = response.data.data[tokenMint];
            console.log(`Token price for ${tokenMint}: $${priceData.price}`);
            return priceData;
        } else {
            console.error("No price data available for", tokenMint);
            return null;
        }
    } catch (error) {
        console.error("Error fetching token price:", error);
        return null;
    }
}

/**
 * Gets all possible swap routes for a token pair
 * @param {string} inputMint - Input token mint address
 * @param {string} outputMint - Output token mint address
 * @param {number} amount - Amount in input token's smallest units
 * @returns {Promise<Array>} - Available swap routes
 */
async function getSwapRoutes(inputMint, outputMint, amount) {
    try {
        // Normalize SOL addresses
        if (inputMint === "11111111111111111111111111111111") {
            inputMint = NATIVE_MINT.toBase58();
        }
        if (outputMint === "11111111111111111111111111111111") {
            outputMint = NATIVE_MINT.toBase58();
        }
        
        // Get routes from Jupiter API
        const response = await axios.get(
            `https://quote-api.jup.ag/v4/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
        );
        
        if (response.data && response.data.routes) {
            console.log(`Found ${response.data.routes.length} routes for ${inputMint} to ${outputMint}`);
            return response.data.routes;
        } else {
            console.error("No routes available for this swap");
            return [];
        }
    } catch (error) {
        console.error("Error fetching swap routes:", error);
        return [];
    }
}

module.exports = {
    jupSwap,
    advanceJupSwap,
    getTokenPrice,
    getSwapRoutes
};
