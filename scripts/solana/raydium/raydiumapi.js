const { Transaction, VersionedTransaction, sendAndConfirmTransaction,ComputeBudgetProgram, SystemProgram, PublicKey, Keypair} = require('@solana/web3.js');
const { NATIVE_MINT, transfer, createTransferInstruction,getOrCreateAssociatedTokenAccount,TOKEN_PROGRAM_ID} = require('@solana/spl-token');
const axios = require('axios');
const { connection,bot,jitoConnection, fetchTokenAccountData,getRandomTipAccount } = require('./config');
const { API_URLS } = require('@raydium-io/raydium-sdk-v2');
const base58 = require("bs58");
const ethers = require("ethers");
const {zeroAddress} = require("ethereumjs-util");
const baseDao = require("../utils/mysqlsol");
const pumpCoinApi = require("./pump/api");
const {Bot} = require("grammy");
const utils = require("../utils/utils");
const redis = require("../utils/redis");
const swapautoapi = require("./swapautoapi");
const lanutils = require("../utils/lan/lanutils");
const pumpApi = require("./pump/solpump");
const okxwebapi = require("./okxwebapi");
const { Raydium, TxVersion, parseTokenAccountResp } = require('@raydium-io/raydium-sdk-v2')

const pmupfunApi = require("./pump/api");

async function raySwap(address, inputMint, outputMint,amount,order,from="api") {

    if (inputMint==="11111111111111111111111111111111")
    {
        inputMint = NATIVE_MINT.toBase58();
    }
    if (outputMint==="11111111111111111111111111111111")
    {
        outputMint = NATIVE_MINT.toBase58();
    }

    console.time('User private key and configuration loading');
    let appmembers = await baseDao.syncQuery("SELECT wallet.secretkey,member.* FROM `appwalletuser` wallet LEFT JOIN appmember member ON member.tg_id = wallet.tg_id   WHERE address = ?",
        [address]);
    let member = appmembers[0];
    const owner = Keypair.fromSecretKey(base58.default.decode(utils.decrypt(member.secretkey)))
    let mode = member.mode;
    let slippage = member.qmode_slip; // Slippage
    if (mode == 1) {
        slippage = member.jmode_slip; // Slippage
    }
    let botSwapFeeRatio =  await redis.get("botSwapFeeRatio");
    let solprice =  await redis.get("solprice");

    if (order)
    {
         bot.api.sendMessage(member.tg_id,"Order has triggered the specified price, transaction in progress..").then()
    }else
    {
         bot.api.sendMessage(member.tg_id,"Transaction in progress..").then()
    }
    const txVersion = 'LEGACY'; // or LEGACY
    const isV0Tx = txVersion === 'V0';
    const isInputSol = inputMint === NATIVE_MINT.toBase58();
    let priorityFeeInSol = 0; // Priority fee
    if (isInputSol)
    {
        priorityFeeInSol = Number(member.buygas) * 1e9; // Priority fee
    }
    const isOutputSol = outputMint === NATIVE_MINT.toBase58();
    if (isOutputSol)
    {
        priorityFeeInSol = Number(member.sellgas) * 1e9; // Priority fee
    }
    priorityFeeInSol = priorityFeeInSol.toFixed(0);

    const tokenAccounts = await fetchTokenAccountData(owner);
    const inputTokenAcc = tokenAccounts.find((a) => a.mint === inputMint)?.publicKey;
    const outputTokenAcc = tokenAccounts.find((a) => a.mint === outputMint)?.publicKey;
    let raygas =   await redis.get("raygas");
    if (raygas==null)
    {
        const feeResponse = await axios.get(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`);
        const feeData = feeResponse.data;
        redis.set("raygas",Number(feeData.data.default.h)).then()
        raygas = feeData.data.default.h;
    }
    {
        axios.get(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`).then(function (feeResponse) {
            const feeData = feeResponse.data;
            redis.set("raygas",Number(feeData.data.default.h)).then()
        })
    }
    let veryHigh = Number(raygas)+Number(priorityFeeInSol);
    const swapResponse = await axios.get(
        `${API_URLS.SWAP_HOST}/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100}&txVersion=${txVersion}`
    );

    if (swapResponse.data.success == false)
    {
        await bot.api.sendMessage(member.tg_id,"Transaction failed")
        return null;

    } else{

        let amount = 0
        if (isInputSol)
        {
            amount = await getRPCPoolInfo(outputMint)
        }else
        {
            amount = await getRPCPoolInfo(inputMint)
        }
        console.log("amount",amount)
        if (amount<5)
        {
            await bot.api.sendMessage(member.tg_id,"Transaction failed")
            return  null;
        }
    }

    const swapTransactions = await axios.post(`${API_URLS.SWAP_HOST}/transaction/swap-base-in`, {
        computeUnitPriceMicroLamports: String(veryHigh),
        swapResponse: swapResponse.data,
        txVersion,
        wallet: owner.publicKey.toBase58(),
        wrapSol: isInputSol,
        unwrapSol: !isInputSol, // true means output mint receive SOL, false means output mint received wSOL
        inputAccount: isInputSol ? undefined :inputTokenAcc,
        outputAccount: isInputSol ? outputTokenAcc:undefined,
    });
    if (swapTransactions.data.success == false)
    {
        console.log(swapTransactions.data)
        await bot.api.sendMessage(member.tg_id,"Transaction failed")
        return null;
    }
    const allTxBuf = swapTransactions.data.data.map((tx) => Buffer.from(tx.transaction, 'base64'));
    const allTransactions = allTxBuf.map((txBuf) =>
        isV0Tx ? VersionedTransaction.deserialize(txBuf) : Transaction.from(txBuf)
    );
    let fee = 0
    for (const tx of allTransactions) {
        const transaction = tx;
        if (inputMint===NATIVE_MINT.toBase58())
        {
            fee = (amount*Number(botSwapFeeRatio)).toFixed(0);
            const sendSolInstruction = SystemProgram.transfer({
                fromPubkey: owner.publicKey,
                toPubkey: new PublicKey("CbFcjx6HsgbuKEdT7NZ3FZ81kDSQqnL2SZU1PvLqshgm"),
                lamports:fee ,
            });
            transaction.add(sendSolInstruction);
        }else
        {

            let prices = await okxwebapi.getTokenPrice(inputMint);
            if (prices.length>0) {
                let price = prices[0].price;

                let tokenAmount = ethers.utils.formatUnits(amount,prices[0].decimal);
                console.log("tokenAmount",tokenAmount)
                fee =  ((Number(tokenAmount)*(price)*1e9)/solprice*Number(botSwapFeeRatio)).toFixed(0)
                console.log("fee",fee)
                const sendSolInstruction = SystemProgram.transfer({
                    fromPubkey:owner.publicKey,
                    toPubkey: new PublicKey("CbFcjx6HsgbuKEdT7NZ3FZ81kDSQqnL2SZU1PvLqshgm"),
                    lamports:fee ,
                });
                transaction.add(sendSolInstruction);
            }
        }
        transaction.feePayer = owner.publicKey;
        let myConnection = connection;
        if (Number(mode)===1)
        {
            myConnection = jitoConnection;
            console.log("Sandwich protection transaction")
            // Construct tip instruction
            const tipInstruction = SystemProgram.transfer({
                fromPubkey: owner.publicKey,
                toPubkey: new PublicKey(getRandomTipAccount()),
                lamports: priorityFeeInSol,
            });
            transaction.add(tipInstruction);
        }

        const simulateResult = await myConnection.simulateTransaction(transaction);
        if (simulateResult.value.err) {
            console.timeEnd('startTime1');
            console.log("Transaction simulation failed:", simulateResult.value.err);
            await bot.api.sendMessage(member.tg_id,"Transaction failed")
            return;
        }
        try {
            console.time('Transaction execution');
            const txId = await sendAndConfirmTransaction(myConnection, transaction, [owner],
                {skipPreflight: true,commitment: 'processed'})
            console.timeEnd('Transaction execution');
            let type = "sell"
            let inamount = 0;
            let price = 0;
            if (inputMint===NATIVE_MINT.toBase58())
            {
                type = "buy"
                let  message = await  bot.api.sendMessage(member.tg_id,"" +
                    "✅Transaction broadcasted and in progress on-chain!"+(Number(mode)==0?"["+await lanutils.lan("djck", member.tg_id)+"](https://solscan.io/tx/"+txId+")":"")+" \n"
                    ,{parse_mode: "Markdown",
                    disable_web_page_preview: true
                })
                await baseDao.syncQuery("INSERT INTO `appswaporder` (`address`, `token`,`intoken`, `amount`, `hash`, `time`, `type`, `dex`,`upgas`,`inamount`,`price`,`fee`,`check`,`chatid`,`messageId`,`from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    [owner.publicKey.toBase58(),outputMint,"11111111111111111111111111111111",amount,txId,new Date(),type,"okex",priorityFeeInSol,inamount,price,fee/1e9,1,message.chat.id, message.message_id,from])
                console.log("Transaction hash",txId)
                return txId;

            }else
            {

                let message =  await bot.api.sendMessage(member.tg_id,"" +
                    "✅Transaction broadcasted and in progress on-chain!"+(Number(mode)==0?"["+await lanutils.lan("djck", member.tg_id)+"](https://solscan.io/tx/"+txId+")":"")+" \n"
                   ,{parse_mode: "Markdown",
                    disable_web_page_preview: true
                })
                await baseDao.syncQuery("INSERT INTO `appswaporder` (`address`, `token`,`intoken`, `amount`, `hash`, `time`, `type`, `dex`,`upgas`,`inamount`,`price`,`fee`,`check`,`chatid`,`messageId`,`from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    [owner.publicKey.toBase58(),"11111111111111111111111111111111",inputMint, inamount,txId,new Date(),type,"okex",priorityFeeInSol,amount,price,fee/1e9,1,message.chat.id, message.message_id,from])

                console.log("Transaction hash",txId)
                return txId;

            }

        }catch (e) {

            console.log(e);
            await bot.api.sendMessage(member.tg_id,"Transaction failed")
            return null;

        }

    }



}
async function advanceSwap(address, inputMint, outputMint,amount,percent,from="api") {

    if (inputMint==="11111111111111111111111111111111")
    {
        inputMint = NATIVE_MINT.toBase58();
    }
    if (outputMint==="11111111111111111111111111111111")
    {
        outputMint = NATIVE_MINT.toBase58();
    }
    console.time('User private key and configuration loading');
    let appmembers = await baseDao.syncQuery("SELECT wallet.secretkey,member.* FROM `appwalletuser` wallet LEFT JOIN appmember member ON member.tg_id = wallet.tg_id   WHERE address = ?",
        [address]);
    let member = appmembers[0];
    const owner = Keypair.fromSecretKey(base58.default.decode(utils.decrypt(member.secretkey)))
    let mode = member.mode;
    let slippage = member.qmode_slip; // Slippage
    if (mode == 1) {
        slippage = member.jmode_slip; // Slippage
    }
    let botSwapFeeRatio =  await redis.get("botSwapFeeRatio");
    let solprice =  await redis.get("solprice");

    bot.api.sendMessage(member.tg_id,"Scraper transaction in progress..").then()

    const txVersion = 'LEGACY'; // or LEGACY
    const isV0Tx = txVersion === 'V0';
    const isInputSol = inputMint === NATIVE_MINT.toBase58();
    let priorityFeeInSol = 0; // Priority fee
    let pools = []
    if (isInputSol)
    {

        // pools = await pmupfunApi.getPumpPool(inputMint)
        priorityFeeInSol = Number(member.buygas) * 1e9; // Priority fee
    }
    const isOutputSol = outputMint === NATIVE_MINT.toBase58();
    if (isOutputSol)
    {
        // pools = await pmupfunApi.getPumpPool(inputMint)
        priorityFeeInSol = Number(member.sellgas) * 1e9; // Priority fee
    }
    priorityFeeInSol = priorityFeeInSol.toFixed(0);

    const tokenAccounts = await fetchTokenAccountData(owner);
    const inputTokenAcc = tokenAccounts.find((a) => a.mint === inputMint)?.publicKey;
    const outputTokenAcc = tokenAccounts.find((a) => a.mint === outputMint)?.publicKey;
    let raygas =   await redis.get("raygas");
    if (raygas==null)
    {
        const feeResponse = await axios.get(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`);
        const feeData = feeResponse.data;
        redis.set("raygas",Number(feeData.data.default.h)).then()
        raygas = feeData.data.default.h;
    }
    {
        axios.get(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`).then(function (feeResponse) {
            const feeData = feeResponse.data;
            redis.set("raygas",Number(feeData.data.default.h)).then()
        })
    }
    let veryHigh = Number(raygas)+Number(priorityFeeInSol);
    const swapResponse = await axios.get(
        `${API_URLS.SWAP_HOST}/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100}&txVersion=${txVersion}`
    );
    if (swapResponse.data.success == false)
    {
        await bot.api.sendMessage(member.tg_id,"Transaction failed")
        return null;

    } else{

        let amount = 0
        if (isInputSol)
        {
            amount = await getRPCPoolInfo(outputMint)
        }else
        {
            amount = await getRPCPoolInfo(inputMint)
        }
        console.log("amount",amount)
        if (amount<5)
        {
            await bot.api.sendMessage(member.tg_id,"Transaction failed")
            return  null;
        }
    }
    const swapTransactions = await axios.post(`${API_URLS.SWAP_HOST}/transaction/swap-base-in`, {
        computeUnitPriceMicroLamports: String(veryHigh),
        swapResponse: swapResponse.data,
        txVersion,
        wallet: owner.publicKey.toBase58(),
        wrapSol: isInputSol,
        unwrapSol: !isInputSol, // true means output mint receive SOL, false means output mint received wSOL
        inputAccount: isInputSol ? undefined :inputTokenAcc,
        outputAccount: isInputSol ? outputTokenAcc:undefined,
    });
    if (swapTransactions.data.success == false)
    {
        console.log(swapTransactions.data)
        await bot.api.sendMessage(member.tg_id,"Transaction failed")
        return null;
    }
    const allTxBuf = swapTransactions.data.data.map((tx) => Buffer.from(tx.transaction, 'base64'));
    const allTransactions = allTxBuf.map((txBuf) =>
        isV0Tx ? VersionedTransaction.deserialize(txBuf) : Transaction.from(txBuf)
    );
    let fee = 0
    for (const tx of allTransactions) {
        const transaction = tx;
        if (inputMint===NATIVE_MINT.toBase58())
        {
            fee = (amount*Number(botSwapFeeRatio)).toFixed(0);
            const sendSolInstruction = SystemProgram.transfer({
                fromPubkey: owner.publicKey,
                toPubkey: new PublicKey("CbFcjx6HsgbuKEdT7NZ3FZ81kDSQqnL2SZU1PvLqshgm"),
                lamports:fee ,
            });
            transaction.add(sendSolInstruction);
        }else
        {
            let decimals =  await redis.get(inputMint+"decimals");
            if (decimals==null)
            {
                let pair = await swapautoapi.getTokenPairs(inputMint)
                decimals = pair.pairs[0].pair[0].tokenDecimals
                await redis.set(inputMint+"decimals",decimals);
            }
            let tokenDetail = await swapautoapi.getTokensPrice(inputMint);
            let tokenamount = Number(ethers.utils.formatUnits(amount,decimals));
            fee = (tokenamount*Number(tokenDetail.usdPrice)*1e9/solprice*Number(botSwapFeeRatio)).toFixed(0);
            const sendSolInstruction = SystemProgram.transfer({
                fromPubkey: owner.publicKey,
                toPubkey: new PublicKey("CbFcjx6HsgbuKEdT7NZ3FZ81kDSQqnL2SZU1PvLqshgm"),
                lamports:fee ,
            });
            transaction.add(sendSolInstruction);
        }
        transaction.feePayer = owner.publicKey;
        let myConnection = connection;
        if (Number(mode)===1)
        {
            myConnection = jitoConnection;
            console.log("Sandwich protection transaction")
            // Construct tip instruction
            const tipInstruction = SystemProgram.transfer({
                fromPubkey: owner.publicKey,
                toPubkey: new PublicKey(getRandomTipAccount()),
                lamports: priorityFeeInSol,
            });
            transaction.add(tipInstruction);
        }

        const simulateResult = await myConnection.simulateTransaction(transaction);
        if (simulateResult.value.err) {
            console.timeEnd('startTime1');
            console.log("Transaction simulation failed:", simulateResult.value.err);
            await bot.api.sendMessage(member.tg_id,"Transaction failed")
            return;
        }

        try {
            console.time('Transaction execution');
            const txId = await sendAndConfirmTransaction(myConnection, transaction, [owner],
                {skipPreflight: true,commitment: 'processed'})
            console.timeEnd('Transaction execution');
            let type = "sell"
            let inamount = 0;
            let price = 0;
            if (inputMint===NATIVE_MINT.toBase58())
            {
                type = "buy"
                fee = (amount*Number(botSwapFeeRatio)).toFixed(0);
                amount = amount/1e9
                inamount = 0;
                price = 0
                let  message = await  bot.api.sendMessage(member.tg_id,"" +
                    "✅Transaction broadcasted and in progress on-chain!"+(Number(mode)==0?"["+await lanutils.lan("djck", member.tg_id)+"](https://solscan.io/tx/"+txId+")":"")+" \n"
                    ,{parse_mode: "Markdown",
                        disable_web_page_preview: true
                    })
                if (percent)
                {
                    if (percent.stoplossamountpercent==null)
                    {
                        percent.stoplossamountpercent = 0
                    }
                    if (percent.pricemaxcheck==null)
                    {
                        percent.pricemaxcheck = 0
                    }
                    if (percent.stopmaxnum==null)
                    {
                        percent.stopmaxnum = 3
                    }
                    await baseDao.syncQuery("INSERT INTO `appswaporder` (`address`, `token`,`intoken`, `amount`, `hash`, `time`, `type`, `dex`,`upgas`,`inamount`,`price`,`fee`,`check`,`chatid`,`messageId`,`stopearnpercent`,`stoplosspercen`,`amountpercent`,`stopmode`,`stoplossamountpercent`,`pricemaxcheck`,`stopmaxnum`,`from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        [owner.publicKey.toBase58(),outputMint,"11111111111111111111111111111111",amount,txId,new Date(),type,"okex",priorityFeeInSol,inamount,price,fee/1e9,1,message.chat.id, message.message_id,percent.stopearnpercent,percent.stoplosspercent,percent.amountpercent,"1",percent.stoplossamountpercent,percent.pricemaxcheck,percent.stopmaxnum,from])

                }else
                {
                    await baseDao.syncQuery("INSERT INTO `appswaporder` (`address`, `token`,`intoken`, `amount`, `hash`, `time`, `type`, `dex`,`upgas`,`inamount`,`price`,`fee`,`check`,`chatid`,`messageId`,`from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        [owner.publicKey.toBase58(),outputMint,"11111111111111111111111111111111",amount,txId,new Date(),type,"okex",priorityFeeInSol,inamount,price,fee/1e9,1,message.chat.id, message.message_id,from])
                }


                return txId;

            }

        }catch (e) {

            console.log(e);
            await bot.api.sendMessage(member.tg_id,"Transaction failed")
            return null;

        }

    }



}
async function getRPCPoolInfo(targetTokenAddress) {

    const cluster = 'mainnet';
    const owner = Keypair.fromSecretKey(base58.default.decode('36UVt4QGs6KBd8YddTdzUTqSS3bDga1aXKzaP23mot4PRG1JQBSfcedZvAzMaHoaD5vBVtnqHpL7rk8sWjsaCWXp'));
    const raydium = await Raydium.load({
        owner,
        connection,
        cluster,
        disableFeatureCheck: true,
        disableLoadToken: false,
        blockhashCommitment: 'finalized',
    });
    const data = await raydium.api.fetchPoolByMints({
        mint1: "So11111111111111111111111111111111111111112",
        mint2: targetTokenAddress, // optional,
    });
    if (data.data.length > 0) {
        let pool = data.data[0];
        console.log(pool)
        const { mintA, mintB, mintAmountA, mintAmountB } = pool;
        console.log(mintA, mintB, mintAmountA, mintAmountB)

        if (mintA.address.toString() === "So11111111111111111111111111111111111111112") {
            console.log(mintAmountA);
            return mintAmountA;
        } else if (mintB.address.toString() === "So11111111111111111111111111111111111111112") {
            console.log(mintAmountB);
            return mintAmountB;

        } else {
            console.log("No match found for So11111111111111111111111111111111111111112");
        }
    }
    console.log('Data:', data.data.length > 0);
}

module.exports = {
    raySwap,
    advanceSwap,
    getRPCPoolInfo
}
