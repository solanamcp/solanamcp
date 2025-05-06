const gmgnapi = require("./gmgnapi");
const pumpCoinApi = require("./pump/api");
const okexapi = require("./okexapi");
const swapautoapi = require("./swapautoapi");
const okxwebapi = require("./okxwebapi");
const solanaWeb3 = require("@solana/web3.js");

let tokenInfo = {
    address: '',
    price: '',
    volume_24h: '',
    symbol:"",
    totalSupply:"",
    mint:"",
    marketCap:'',
    security: {
        "is_show_alert": false,
        "top_10_holder_rate": "0",
        "renounced_mint": false,
        "renounced_freeze_account": true,
        "burn_ratio": "0",
        "burn_status": "none",
        "dev_token_burn_amount": "0",
        "dev_token_burn_ratio":"0",
    },
    poolInfo: {
        quote_symbol: 'SOL',
        liquidity: '0',
    },
    tokenlink: {
        website: '',
        telegram: '',
        twitter_username: '',
    }
}
async function getTokenDetailForMint(tokenAddress) {

    console.log("getTokenDetailForMint");
    let token= null
        // await gmgnapi.getTokenInfo(tokenAddress);
    if (token == null)
    {
        token = tokenInfo;
        let okwebTokens = await okxwebapi.getTokenPrice(tokenAddress);
        if (okwebTokens&&okwebTokens.length>0)
        {
            let okwebToken = okwebTokens[0]
            token.address = tokenAddress;
            token.symbol = okwebToken.tokenSymbol;
            token.decimal = okwebToken.decimal
            token.price = okwebToken.price;
            token.volume_24h = okwebToken.volume
            token.poolInfo.liquidity = okwebToken.liquidity
            token.marketCap = okwebToken.marketCap
        }
        let security =  await gmgnapi.getTokenSecurity(tokenAddress);
        if (security)
        {
            token.security = security;
        }
        let tokenlink =  await gmgnapi.getTokenLink(tokenAddress);
        if (tokenlink)
        {
            token.tokenlink = tokenlink;
        }else
        {
            let okwebTokenOverviews = await okxwebapi.getTokenOverview(tokenAddress);
            if (okwebTokenOverviews.length>0)
            {
                let overview = okwebTokenOverviews[0]
                token.tokenlink.website = overview.socialMedia.officialWebsite
                token.tokenlink.telegram = overview.socialMedia.telegram
                token.tokenlink.twitter_username = overview.socialMedia.twitter
            }
        }
        console.log("token",token);
    }
    if (token != null)
    {

        token.mint = tokenAddress;
        return token;
    }
    else
    {
        return null;
    }

}

module.exports = {

    getTokenDetailForMint
}

