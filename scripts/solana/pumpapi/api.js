const axios = require("axios");

async function getCoinData(mintStr) {
    try {
        const url = `https://frontend-api-v3.pump.fun/coins/${mintStr}`;
        console.log("getCoinData",url)
        const response = await axios.get(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
                Accept: "*/*",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br",
                Referer: "https://www.pump.fun/",
                Origin: "https://www.pump.fun",
                Connection: "keep-alive",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "If-None-Match": 'W/"43a-tWaCcS4XujSi30IFlxDCJYxkMKg"',
            },
        });
        if (response.status === 200) {
            return response.data;
        } else {
            console.error("Failed to retrieve coin data:", response.status);
            return null;
        }
    } catch (error) {
        console.error("Error fetching coin data:", error);
        return null;
    }
}
async function getPumpPool(mintStr) {
    try {
        const url = `https://swap-api.pump.fun/v1/pools/pump-pool?base=${mintStr}`;
        const response = await axios.get(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
                Accept: "*/*",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br",
                Referer: "https://www.pump.fun/",
                Origin: "https://www.pump.fun",
                Connection: "keep-alive",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "If-None-Match": 'W/"43a-tWaCcS4XujSi30IFlxDCJYxkMKg"',
            },
        });
        console.log(response.data);

        if (response.status === 200) {
            return response.data;
        } else {
            console.error("Failed to retrieve coin data:", response.status);
            return null;
        }
    } catch (error) {
        console.error("Error fetching coin data:", error);
        return null;
    }
}

module.exports = { getCoinData,getPumpPool};
