const {
    PublicKey,
    ComputeBudgetProgram,
    SystemProgram,
    TransactionMessage,
    VersionedTransaction,
    Keypair,
    Connection, TransactionInstruction,LAMPORTS_PER_SOL
} = require("@solana/web3.js");
const {getBuyTokenAmount, calculateWithSlippageBuy, getPumpSwapPool} = require("./pool");
const {
    getAssociatedTokenAddressSync,
    getOrCreateAssociatedTokenAccount,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction
} = require("@solana/spl-token");
const  base58 = require("bs58")  ;
const redis = require("../../utils/redis");
const utils = require("../../utils/utils");
const baseDao = require('./../../utils/mysqlsol');
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const WSOL_TOKEN_ACCOUNT = new PublicKey('So11111111111111111111111111111111111111112');
const global = new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw');
const eventAuthority = new PublicKey('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR');
const feeRecipient = new PublicKey('62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV');
const feeRecipientAta = new PublicKey('94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb');
const BUY_DISCRIMINATOR = new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]);
const { connection,jitoConnection,bot, fetchTokenAccountData,getRandomTipAccount } = require('../config');
const lanutils = require("../../utils/lan/lanutils");
const okxwebapi = require("../okxwebapi");
const ethers = require("ethers");
const axios = require("axios");
const crypto = require('crypto');
const querystring = require('querystring');

async function buy(mint, address,solToBuy,percent,from="bot",coinData) {

    let appmembers = await baseDao.syncQuery("SELECT wallet.secretkey,member.* FROM `appwalletuser` wallet LEFT JOIN appmember member ON member.tg_id = wallet.tg_id   WHERE address = ?",
        [address]);
    let member = appmembers[0];
    let mode = member.mode;
    let slippage = member.qmode_slip;
    if (mode == 1) {
        slippage = member.jmode_slip;
    }
    let  priorityFeeInSol = Number(member.buygas) * LAMPORTS_PER_SOL;
    const payer = Keypair.fromSecretKey(base58.default.decode(utils.decrypt(member.secretkey)));

    const solInLamports = solToBuy;
    let solprice =  await redis.get("solprice");
    let prices = await okxwebapi.getTokenPrice(mint);

    const price = prices[0].price;

    let buyAmount = BigInt(Math.floor(solToBuy*(1+slippage)));

    let amount = BigInt(Math.floor(((solInLamports/1e9) / (price/solprice))));

    let tokenOut = BigInt(ethers.utils.parseUnits(amount.toString(), prices[0].decimal).toString());

    console.log("virtual_token_reserves",solInLamports,price,tokenOut);
    const pool = await getPumpSwapPool(mint);

    let myToken = await getToken(pool.toString(), "So11111111111111111111111111111111111111112");
    console.log(myToken);
    if (Number(myToken.balance)<10)
    {
        return null;
    }
    console.log("getPumpSwapPool",getPumpSwapPool);
    const pumpswap_buy_tx = await createBuyInstruction(pool, payer.publicKey, mint,  tokenOut, buyAmount);
    const ata = getAssociatedTokenAddressSync(mint, payer.publicKey);
    const associatedTokenAccount = await getAssociatedTokenAddressSync(
        WSOL_TOKEN_ACCOUNT,
        payer.publicKey
    );
    console.log("associatedTokenAccount",associatedTokenAccount.toBase58());
    const ix_list = [];
    ix_list.push( ComputeBudgetProgram.setComputeUnitLimit({
        units: 200000,
    }));
    ix_list.push(ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1696969
    }));
    ix_list.push(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, associatedTokenAccount, payer.publicKey, WSOL_TOKEN_ACCOUNT));

    ix_list.push(SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: associatedTokenAccount,
        lamports:buyAmount,
    }));
    ix_list.push(createSyncNativeInstruction(associatedTokenAccount));

    ix_list.push(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, mint));
    ix_list.push(pumpswap_buy_tx);

    ix_list.push(createCloseAccountInstruction(
        associatedTokenAccount,
        payer.publicKey,
        payer.publicKey
    ));

    let botSwapFeeRatio =  await redis.get("botSwapFeeRatio");
    let  fee = (Number(solToBuy)*Number(botSwapFeeRatio)).toFixed(0);
    const sendSolInstruction = SystemProgram.transfer({
        fromPubkey:payer.publicKey,
        toPubkey: new PublicKey("CbFcjx6HsgbuKEdT7NZ3FZ81kDSQqnL2SZU1PvLqshgm"),
        lamports:fee ,
    });
    ix_list.push(sendSolInstruction);

    const latestBlockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: ix_list,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer]);
    let txId = await connection.sendRawTransaction(transaction.serialize(),{
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        commitment: 'confirmed'
    });
    let  message = await  bot.api.sendMessage(member.tg_id,"" +
        "✅ Broadcasted and processing on-chain!"+(Number(mode)==0?"["+await lanutils.lan("djck", member.tg_id)+"](https://solscan.io/tx/"+txId+")":"")+" \n"
        ,{parse_mode: "Markdown",
            disable_web_page_preview: true
        });

    if (percent)
    {
        if (percent.stoplossamountpercent==null)
        {
            percent.stoplossamountpercent = 0;
        }
        if (percent.pricemaxcheck==null)
        {
            percent.pricemaxcheck = 0;
        }
        if (percent.stopmaxnum==null)
        {
            percent.stopmaxnum = 3;
        }
        await baseDao.syncQuery("INSERT INTO `appswaporder` (`address`, `token`,`intoken`, `amount`, `hash`, `time`, `type`, `dex`,`upgas`,`inamount`,`price`,`fee`,`check`,`chatid`,`messageId`,`stopearnpercent`,`stoplosspercen`,`amountpercent`,`stopmode`,`stoplossamountpercent`,`pricemaxcheck`,`stopmaxnum`,`from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [payer.publicKey.toBase58(),mint.toBase58(),"11111111111111111111111111111111",0,txId,new Date(),"buy","okex",priorityFeeInSol,0,0,fee/1e9,1,message.chat.id, message.message_id,percent.stopearnpercent,percent.stoplosspercent,percent.amountpercent,"1",percent.stoplossamountpercent,percent.pricemaxcheck,percent.stopmaxnum,from]);

    }else
    {
        await baseDao.syncQuery("INSERT INTO `appswaporder` (`address`, `token`,`intoken`, `amount`, `hash`, `time`, `type`, `dex`,`upgas`,`inamount`,`price`,`fee`,`check`,`chatid`,`messageId`,`from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [payer.publicKey.toBase58(),mint.toBase58(),"11111111111111111111111111111111",0,txId,new Date(),"buy","okex",priorityFeeInSol,0,0,fee/1e9,1,message.chat.id, message.message_id,from]);
        console.log("Transaction hash",txId);
    }
    console.log(txId);
    return txId;


}

async function sell(mint, address, amount,from) {

    let appmembers = await baseDao.syncQuery("SELECT wallet.secretkey,member.* FROM `appwalletuser` wallet LEFT JOIN appmember member ON member.tg_id = wallet.tg_id   WHERE address = ?",
        [address]);
    let member = appmembers[0];
    let mode = member.mode;
    let slippage = member.qmode_slip;
    if (mode == 1) {
        slippage = member.jmode_slip;
    }
    let  priorityFeeInSol = Number(member.buygas) * LAMPORTS_PER_SOL;
    const payer = Keypair.fromSecretKey(base58.default.decode(utils.decrypt(member.secretkey)));

    const pool = await getPumpSwapPool(mint);


    let myToken = await getToken(pool.toString(), "So11111111111111111111111111111111111111112");
    if (Number(myToken.balance)<10)
    {
        return null;
    }

    const pumpswap_buy_tx = await createSellInstruction(pool, payer.publicKey, mint, BigInt(Math.floor(amount)), BigInt(0));
    const ata = getAssociatedTokenAddressSync(mint, payer.publicKey);
    const associatedTokenAccount = await getAssociatedTokenAddressSync(
        WSOL_TOKEN_ACCOUNT,
        payer.publicKey
    );
    const ix_list = [
        ...[
            ComputeBudgetProgram.setComputeUnitLimit({
                units: 300000,
            }),
            ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 1896969
            })
        ],
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, associatedTokenAccount, payer.publicKey, WSOL_TOKEN_ACCOUNT),
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, mint),
        pumpswap_buy_tx,
        createCloseAccountInstruction(
            associatedTokenAccount,
            payer.publicKey,
            payer.publicKey
        )
    ];

    let solprice =  await redis.get("solprice");
    let prices = await okxwebapi.getTokenPrice(mint);
    let fee = 0;
    if (prices.length>0) {
        let price = prices[0].price;
        let botSwapFeeRatio =  await redis.get("botSwapFeeRatio");
        let tokenAmount = ethers.utils.formatUnits(amount.toString(),prices[0].decimal);
        console.log("tokenAmount",tokenAmount);
        fee =  ((Number(tokenAmount)*(price)*1e9)/solprice*Number(botSwapFeeRatio)).toFixed(0);
    }

    const latestBlockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: ix_list,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer]);

    try {
        let txId = await connection.sendRawTransaction(transaction.serialize(),{
            skipPreflight: true,
            preflightCommitment: 'confirmed',
            commitment: 'confirmed'
        });
        let message =  await bot.api.sendMessage(member.tg_id,"" +
            "✅ Broadcasted and processing on-chain!"+(Number(mode)==0?"["+await lanutils.lan("djck", member.tg_id)+"](https://solscan.io/tx/"+txId+")":"")+" \n"
            ,{parse_mode: "Markdown",
                disable_web_page_preview: true
            });
        await baseDao.syncQuery("INSERT INTO `appswaporder` (`address`, `token`,`intoken`, `amount`, `hash`, `time`, `type`, `dex`,`upgas`,`inamount`,`price`,`fee`,`check`,`chatid`,`messageId`,`from`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [payer.publicKey.toBase58(),"11111111111111111111111111111111",mint.toBase58(), 0,txId,new Date(),"sell","okex",priorityFeeInSol,0,0,fee/1e9,1,message.chat.id, message.message_id,from]);


        return txId;
    }catch (e) {
        console.error(e);
        await bot.api.sendMessage(member.tg_id,"Sell failed");
        return null;
    }


}
async function createBuyInstruction(poolId, user, mint, baseAmountOut,
                                    maxQuoteAmountIn
) {
    const userBaseTokenAccount = await getAssociatedTokenAddress(mint, user);
    const userQuoteTokenAccount = await getAssociatedTokenAddress(WSOL_TOKEN_ACCOUNT, user);
    const poolBaseTokenAccount = await getAssociatedTokenAddress(mint, poolId, true);
    const poolQuoteTokenAccount = await getAssociatedTokenAddress(WSOL_TOKEN_ACCOUNT, poolId, true);
    const accounts = [
        { pubkey: poolId, isSigner: false, isWritable: false },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: global, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: WSOL_TOKEN_ACCOUNT, isSigner: false, isWritable: false },
        { pubkey: userBaseTokenAccount, isSigner: false, isWritable: true },
        { pubkey: userQuoteTokenAccount, isSigner: false, isWritable: true },
        { pubkey: poolBaseTokenAccount, isSigner: false, isWritable: true },
        { pubkey: poolQuoteTokenAccount, isSigner: false, isWritable: true },
        { pubkey: feeRecipient, isSigner: false, isWritable: false },
        { pubkey: feeRecipientAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    const data = Buffer.alloc(8 + 8 + 8);
    data.set(BUY_DISCRIMINATOR, 0);
    data.writeBigUInt64LE(BigInt(baseAmountOut), 8);
    data.writeBigUInt64LE(BigInt(maxQuoteAmountIn), 16);
    return new TransactionInstruction({
        keys: accounts,
        programId: PUMP_AMM_PROGRAM_ID,
        data: data,
    });
}

async function createSellInstruction(poolId, user, mint, baseAmountIn,
                                     minQuoteAmountOut
) {
    const userBaseTokenAccount = await getAssociatedTokenAddress(mint, user);
    const userQuoteTokenAccount = await getAssociatedTokenAddress(WSOL_TOKEN_ACCOUNT, user);
    const poolBaseTokenAccount = await getAssociatedTokenAddress(mint, poolId, true);
    const poolQuoteTokenAccount = await getAssociatedTokenAddress(WSOL_TOKEN_ACCOUNT, poolId, true);
    const accounts = [
        { pubkey: poolId, isSigner: false, isWritable: false },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: global, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: WSOL_TOKEN_ACCOUNT, isSigner: false, isWritable: false },
        { pubkey: userBaseTokenAccount, isSigner: false, isWritable: true },
        { pubkey: userQuoteTokenAccount, isSigner: false, isWritable: true },
        { pubkey: poolBaseTokenAccount, isSigner: false, isWritable: true },
        { pubkey: poolQuoteTokenAccount, isSigner: false, isWritable: true },
        { pubkey: feeRecipient, isSigner: false, isWritable: false },
        { pubkey: feeRecipientAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    const data = Buffer.alloc(8 + 8 + 8);
    data.set(SELL_DISCRIMINATOR, 0);
    data.writeBigUInt64LE(BigInt(baseAmountIn), 8);
    data.writeBigUInt64LE(BigInt(minQuoteAmountOut), 16);
    return new TransactionInstruction({
        keys: accounts,
        programId: PUMP_AMM_PROGRAM_ID,
        data: data,
    });
}

async function apiViewConfig() {

    return   {
        "api_key": 'c1197610-7b15-4985-a29e-c7a5f2b857a3',
        "secret_key": 'DDCD17548170F5C63FC156ECB21CF94D',
        "passphrase": '!Qq520099',
        "project": 'b8e7aee7ba9f44ede2d95732503928d3'
    }

}

function preHash(timestamp, method, request_path, params) {
    let query_string = '';
    if (method === 'GET' && params) {
        query_string = '?' + querystring.stringify(params);
    }
    if (method === 'POST' && params) {
        query_string = JSON.stringify(params);
    }
    return timestamp + method + request_path + query_string;
}
function sign(message, secret_key) {
    const hmac = crypto.createHmac('sha256', secret_key);
    hmac.update(message);
    return hmac.digest('base64');
}
function createSignature(method, request_path, params,api_config) {
    const timestamp = new Date().toISOString().slice(0, -5) + 'Z';
    const message = preHash(timestamp, method, request_path, params);
    const signature = sign(message, api_config['secret_key']);
    return { signature, timestamp };
}

async function sendPostRequest(request_path, params) {
    let api_config = await apiViewConfig();
    const {signature, timestamp} = createSignature("POST", request_path, params,api_config);
    const headers = {
        'OK-ACCESS-KEY': api_config['api_key'],
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': api_config['passphrase'],
        'OK-ACCESS-PROJECT': api_config['project'],
        'Content-Type': 'application/json'
    };

    const config = {
        headers: headers
    }
    let getUrl = "https://www.okx.com" + request_path;
    const data = await axios.post(getUrl, params, config);

    return data.data

}

async function getToken(address,token) {
    const getRequestPath = '/api/v5/wallet/asset/token-balances-by-address';
    let getParams = {
        'address': address,
        'filter': "0",
        'tokenAddresses':[
            {
                'chainIndex': 501,
                'tokenAddress': token,
            }
        ]
    }
    let data = await sendPostRequest(getRequestPath, getParams);
    if (data.data.length>0)
    {
        return data.data[0].tokenAssets[0];
    }else
    {
        return null;
    }


}

module.exports = {buy,sell};


