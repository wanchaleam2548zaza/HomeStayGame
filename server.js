require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

// --- 3.1 Stock System (Persistent Example using MongoDB) ---
// ราคาหุ้นจะถูกเก็บใน collection 'market' เพื่อไม่หายเมื่อรีสตาร์ท
const STOCK_LIST = {
    BTC: { price: 1000000, name: "Bitcoin" },
    ETH: { price: 70000, name: "Ethereum" },
    AAPL: { price: 6000, name: "Apple" },
    TSLA: { price: 8000, name: "Tesla" },
    AMD: { price: 150, name: "AMD" },
    NOK: { price: 100, name: "Nokia" },
    RIOT: { price: 200, name: "Marathon Digital" },
    MARA: { price: 250, name: "Mara Inc" },
    CLSK: { price: 180, name: "CleanSpark" }
};
let STOCK_PRICES = { ...STOCK_LIST };
let STOCK_HISTORY = {}; // เก็บกราฟราคาหุ้นย้อนหลังไว้เป็น Array
// volatility factor (fraction) used when randomizing prices; can be overridden via env var
const VOLATILITY = parseFloat(process.env.STOCK_VOLATILITY) || 0.8; // default ผันผวนแรงขึ้นเป็น ±40%

// mongoose schema for market prices (singleton document)
const marketSchema = new mongoose.Schema({
    _id: { type: String, default: 'global' },
    prices: { type: Object, default: {} },
    updatedAt: { type: Date, default: Date.now }
});
const Market = mongoose.model('Market', marketSchema);

async function loadPrices() {
    try {
        const doc = await Market.findById('global');
        if (doc && doc.prices && Object.keys(doc.prices).length) {
            STOCK_PRICES = doc.prices;
            console.log('✅ Loaded stock prices from DB');
        }
    } catch (e) {
        console.error('❌ Failed to load prices:', e);
    }

    // เติมข้อมูลประวัติหุ้น (Mock History) 30 จุดย้อนหลัง เพื่อให้กราฟไม่มั่ว/ไม่แหว่งตอนเปิดเซิร์ฟ
    for (const symbol in STOCK_PRICES) {
        let base = Math.max(1, STOCK_PRICES[symbol].price * 0.7); // ย้อนหลังให้เริ่มจากราคาต่ำลงนิดหน่อย (หรือสุ่มเอา)
        const hist = [];
        for (let i = 0; i < 29; i++) {
            base += (Math.random() * VOLATILITY / 2 - VOLATILITY / 4) * base;
            hist.push(Math.max(1, Math.round(base)));
        }
        hist.push(STOCK_PRICES[symbol].price); // จุดล่าสุดต้องเป็นราคาปัจจุบัน
        STOCK_HISTORY[symbol] = hist;
    }

    // no doc? initialize and save
    try {
        const docCount = await Market.countDocuments({ _id: 'global' });
        if (docCount === 0) await savePrices();
    } catch (e) { }
}

async function savePrices() {
    try {
        await Market.findByIdAndUpdate('global', {
            prices: STOCK_PRICES,
            updatedAt: Date.now()
        }, { upsert: true, setDefaultsOnInsert: true });
        //console.log('💾 Saved stock prices to DB');
    } catch (e) {
        console.error('❌ Failed to save prices:', e);
    }
}

async function determineMarketStage() {
    // compute average points across all users
    const agg = await User.aggregate([
        { $group: { _id: null, avg: { $avg: "$points" } } }
    ]);
    const avg = agg[0]?.avg || 0;
    let stage;
    if (avg < ECONOMY_CONFIG.stageThresholds.mid) stage = 'early';
    else if (avg < ECONOMY_CONFIG.stageThresholds.late) stage = 'mid';
    else stage = 'late';
    console.log('📈 Market stage computed', stage, 'avgPoints', avg.toFixed(2));
    return stage;
}

async function randomizeStockPrices() {
    const stage = await determineMarketStage();
    const floorFactor = ECONOMY_CONFIG.priceFloors[stage] || 0;

    for (const symbol in STOCK_PRICES) {
        // use last known price as base so movement accumulates
        const current = STOCK_PRICES[symbol]?.price || STOCK_LIST[symbol].price;
        // ✅ สุ่มทิศทาง: 50% ขึ้น, 50% ลง
        const direction = Math.random() < 0.5 ? -1 : 1;
        // ✅ สุ่มขนาด: 0% ถึง VOLATILITY/2 ของราคาปัจจุบัน
        const magnitude = Math.random() * (VOLATILITY / 2);
        const change = direction * magnitude * current;

        // determine minimum allowed price based on floorFactor
        const base = STOCK_LIST[symbol]?.price || current;
        const floor = Math.max(1, Math.floor(base * floorFactor));

        let newPrice = Math.round(current + change);
        if (newPrice < floor) newPrice = floor;

        STOCK_PRICES[symbol].price = newPrice;

        // บันทึกเข้าประวัติ
        if (!STOCK_HISTORY[symbol]) STOCK_HISTORY[symbol] = [];
        STOCK_HISTORY[symbol].push(newPrice);
        if (STOCK_HISTORY[symbol].length > 30) {
            STOCK_HISTORY[symbol].shift(); // เก็บแค่ 30 แท่งย้อนหลัง
        }
    }
    // persist after change
    savePrices();
}
// 1 minute updates (async aware)
setInterval(() => {
    randomizeStockPrices().catch(e => console.error('stock randomize error', e));
}, 60000);

// attempt to load immediately if DB already connected
// after mongoose connection is established later in code the listener will fire
if (mongoose.connection.readyState === 1) {
    loadPrices();
} else {
    mongoose.connection.once('open', loadPrices);
}


const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- 1. Database Connection ---
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log('✅ Connected to MongoDB successfully!'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
} else {
    console.warn('⚠️ MONGO_URI not set — skipping MongoDB connection (running in local/mock mode)');
}

// --- 2. User Schema ---
const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: String,
    avatar: String,
    points: { type: Number, default: 0 },
    pointsPerSecond: { type: Number, default: 0 },
    upgrades: { type: [String], default: [] },
    upgradeCounts: { type: Object, default: {} },
    lastLogin: { type: Date, default: Date.now },
    stocks: { type: Object, default: {} }, // เพิ่มฟิลด์หุ้น
    stockAvgPrices: { type: Object, default: {} }, // เก็บราคาเฉลี่ยที่ซื้อมา
    popularity: { type: Number, default: 0 },
    donationTotal: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// --- 3. Game Data Config ---
const BUSINESS_SHOP = {
    coffee: { cost: 0, power: 5, name: "ร้านกาแฟสตาร์โบ๊ท" },
    repair: { cost: 0, power: 5, name: "ศูนย์ซ่อมมือถือด่วน" },
    vending: { cost: 0, power: 5, name: "ตู้น้ำหยอดเหรียญอัจฉริยะ" },
    convenience: { cost: 0, power: 5, name: "ร้านสะดวกซื้อ" },
    ramen: { cost: 0, power: 5, name: "ร้านราเมน" },
    rental: { cost: 0, power: 5, name: "การบริหารให้เช่า" },
    barbershop: { cost: 0, power: 5, name: "ร้านตัดผม" },
    arcade: { cost: 0, power: 5, name: "ร้านเกมส์อาร์เคด" },
    truck: { cost: 5000, power: 150, name: "กองรถบรรทุกขนส่ง" },
    laundry: { cost: 25000, power: 850, name: "แฟรนไชส์ร้านสะดวกซัก" },
    hotel: { cost: 150000, power: 5500, name: "โรงแรมหรูระดับ 5 ดาว" },
    factory: { cost: 1000000, power: 42000, name: "โรงงานผลิตเซมิคอนดักเตอร์" },
    space: { cost: 50000000, power: 2500000, name: "สถานีขนส่งอวกาศ" }
};

const LOTTERY_CONFIG = {
    tier1: {
        price: 500,
        name: "บัตรเสี่ยงโชค",
        color: "#C0C0C0",
        pool: [
            { threshold: 0.001, name: "แจ็คพอตเงินแสน", amount: 100000, icon: "💰" },
            { threshold: 0.01, name: "รางวัลใหญ่", amount: 50000, icon: "💵" },
            { threshold: 0.1, name: "รางวัลปลอบใจ", amount: 1000, icon: "🪙" }
        ]
    },
    tier2: {
        price: 50000,
        name: "บัตรนักลงทุน",
        color: "#D4AF37",
        pool: [
            { threshold: 0.001, name: "แจ็คพอต 5 ล้าน", amount: 5000000, icon: "💎" },
            { threshold: 0.01, name: "รางวัลใหญ่", amount: 1000000, icon: "🏦" },
            { threshold: 0.1, name: "รางวัลปลอบใจ", amount: 100000, icon: "💸" }
        ]
    },
    tier3: {
        price: 5000000,
        name: "บัตรมหาเศรษฐี",
        color: "#B9F2FF",
        pool: [
            { threshold: 0.001, name: "แจ็คพอต 500 ล้าน", amount: 500000000, icon: "👑" },
            { threshold: 0.01, name: "รางวัลใหญ่", amount: 50000000, icon: "🚀" },
            { threshold: 0.1, name: "รางวัลปลอบใจ", amount: 10000000, icon: "💎" }
        ]
    }
};

// --- Configuration constants for economic rules ---
const ECONOMY_CONFIG = {
    progressiveRate: 1.15,          // multiplier r for progressive cost
    offlineMaxHours: 12,            // cap offline earnings window
    offlineMultiplier: 0.7,         // decay on offline earnings
    offlineHourlyCeilingFactor: 10, // hours worth per hour cap
    wealthThreshold: 100000,        // threshold for upkeep
    upkeepRatePerHour: 0.002,       // 0.2% per hour
    interestRatePerHour: 0.0005,    // 0.05% interest per hour on balance
    transactionTaxRate: 0.01,       // 1% tax on trades/lottery/buy

    // --- Stock price floor configuration (fraction of base price) ---
    // early  : beginners – prices can't fall below 50% of starting value
    // mid    : mid-game  – floor 25%
    // late   : end-game  – floor 10%
    priceFloors: { early: 0.5, mid: 0.25, late: 0.1 },
    // thresholds to determine market stage based on average points
    stageThresholds: { mid: 1e6, late: 1e9 }
};

// --- Helper: คำนวณรายได้แบบมีคู่แข่ง (รวมระบบความนิยม) ---
async function calculateDynamicPPS(discordId) {
    const user = await User.findOne({ discordId });
    if (!user) return { finalPPS: 0, competitorCounts: {} };

    // Grouping หาผลรวมค่าความนิยมของผู้เล่นแต่ละธุรกิจ 
    // น้ำหนักของแต่ละคน = 1 + popularity 
    const popAgg = await User.aggregate([
        { $match: { upgrades: { $exists: true, $type: 'array', $ne: [] } } }, // ✅ exclude users with no upgrades
        { $unwind: { path: '$upgrades', preserveNullAndEmptyArrays: false } },
        {
            $group: {
                _id: "$upgrades",
                totalWeight: { $sum: { $add: [{ $ifNull: ["$popularity", 0] }, 1] } },
                count: { $sum: 1 }
            }
        }
    ]);

    const bizStats = {};
    for (const stat of popAgg) {
        bizStats[stat._id] = { count: stat.count, totalWeight: stat.totalWeight };
    }

    let totalPPS = 0;
    // ✅ สร้าง competitorCounts สำหรับทุกธุรกิจ (ไม่ใช่เฉพาะที่ player มี)
    const competitorCounts = {};
    for (const upgradeId of Object.keys(BUSINESS_SHOP)) {
        competitorCounts[upgradeId] = bizStats[upgradeId]?.count || 0;
    }

    // Support repeatable purchases: upgradeCounts maps upgradeId -> count
    const userCounts = user.upgradeCounts || {};
    for (const upgradeId of Object.keys(userCounts)) {
        const countOwned = Number(userCounts[upgradeId] || 0);
        if (countOwned <= 0) continue;
        const config = BUSINESS_SHOP[upgradeId];
        if (!config) continue;

        const stats = bizStats[upgradeId] || { count: 1, totalWeight: (user.popularity || 0) + 1 };

        // total base power = config.power * countOwned
        const myWeight = (user.popularity || 0) + 1;
        const totalBasePower = config.power * countOwned;
        const dynamicPower = totalBasePower * (myWeight / stats.totalWeight);
        totalPPS += dynamicPower;
    }

    const finalPPS = Number(totalPPS.toFixed(2));
    await User.updateOne({ discordId }, { $set: { pointsPerSecond: finalPPS } });
    return { finalPPS, competitorCounts };
}

// --- 4. API Routes ---

app.post('/api/donate', async (req, res) => {
    const { discordId, amount } = req.body;
    const donateAmount = Math.floor(Number(amount));

    if (!discordId || isNaN(donateAmount) || donateAmount <= 0) {
        return res.status(400).json({ success: false, message: 'จำนวนเงินบริจาคไม่ถูกต้อง' });
    }

    try {
        const user = await User.findOne({ discordId });
        if (!user || user.points < donateAmount) {
            return res.status(400).json({ success: false, message: 'เงินไม่พอสำหรับการบริจาค' });
        }

        // เก็บค่าก่อนหักเพื่อใช้คำนวณเกณฑ์ (ใช้จุดนี้เป็นฐานความมั่งคั่งก่อนบริจาค)
        const pointsBefore = user.points;

        user.points -= donateAmount;

        // --- New: boost donation credit for new players based on account age ---
        const now = Date.now();
        const createdMs = user.createdAt ? new Date(user.createdAt).getTime() : (user.lastLogin ? new Date(user.lastLogin).getTime() : now);
        const ageDays = Math.max(0, (now - createdMs) / 86400000);
        let donationBoost = 1.0;
        if (ageDays < 7) donationBoost = 1.5;      // very new players (first week) get 50% more credit
        else if (ageDays < 30) donationBoost = 1.25; // newish players (first month) get 25% more credit

        const credited = Math.floor(donateAmount * donationBoost);
        user.donationTotal = (user.donationTotal || 0) + credited;

        // กฎเดิม: ความนิยมเพิ่มเมื่อยอดบริจาคสะสมครบทุกๆ "25% ของเงินที่มีของผู้เล่น (ก่อนบริจาค)" จะได้ 1 แต้ม
        // คำนวณ threshold ตาม 25% ของเงินก่อนบริจาค (ขั้นต่ำ 1 เพื่อหลีกเลี่ยงการหารด้วย 0)
        const threshold = Math.max(1, Math.floor(pointsBefore * 0.25));
        user.popularity = Math.floor(user.donationTotal / threshold);

        await user.save();
        res.json({ success: true, points: user.points, popularity: user.popularity, donationTotal: user.donationTotal, donationBoost, credited });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: ประวัติราคาหุ้นสำหรับกราฟ (mock data)
app.get('/api/stock/history/:symbol', async (req, res) => {
    const { symbol } = req.params;
    if (!STOCK_PRICES[symbol]) return res.status(404).json({ success: false, message: 'ไม่พบหุ้นนี้' });

    // ดึงข้อมูล 30 จุดย้อนหลังที่มีในระบบ (ไม่ต้องสุ่มใหม่ทุกครั้งแล้ว)
    const history = STOCK_HISTORY[symbol] || [];
    res.json({ symbol, history });
});

// GET: ราคาหุ้นปัจจุบัน
app.get('/api/stocks', async (req, res) => {
    // ส่งราคาปัจจุบันทั้งหมด
    res.json(STOCK_PRICES);
});

// POST: ซื้อ/ขายหุ้น
app.post('/api/stock/trade', async (req, res) => {
    const { discordId, symbol, action } = req.body;

    console.log('Trade request:', { discordId, symbol, action });

    if (!discordId || !symbol || !action) {
        console.error('Missing fields:', { discordId, symbol, action });
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบ' });
    }

    const user = await User.findOne({ discordId });
    if (!user) {
        console.error('User not found:', discordId);
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
    }

    const stock = STOCK_PRICES[symbol];
    if (!stock) {
        console.error('Stock not found:', symbol);
        return res.status(400).json({ success: false, message: 'ไม่พบหุ้นนี้' });
    }

    user.stocks = user.stocks || {};
    user.stockAvgPrices = user.stockAvgPrices || {};

    // ✅ ดึงค่า quantity จาก request body (ค่าเริ่มต้น 1 ถ้าไม่มี)
    let amount = parseInt(req.body.quantity) || 1;

    // ✅ Validation: จำนวนต้องมากกว่า 0 และเป็นจำนวนเต็มบวก
    if (amount <= 0 || !Number.isInteger(amount)) {
        console.error('Invalid quantity:', { quantity: req.body.quantity, amount });
        return res.status(400).json({ success: false, message: 'จำนวนต้องเป็นจำนวนเต็มบวก' });
    }

    let tax = 0; // will be set per action

    // ✅ กำหนดขีดจำกัดการซื้อ/ขายต่อครั้ง (ป้องกันการทุจริต)
    const MAX_QUANTITY_PER_TRADE = 10000;
    if (amount > MAX_QUANTITY_PER_TRADE) {
        console.error('Quantity exceeds limit:', { amount, max: MAX_QUANTITY_PER_TRADE });
        return res.status(400).json({ success: false, message: `จำนวนต่อครั้งไม่เกิน ${MAX_QUANTITY_PER_TRADE} หน่วย` });
    }

    if (action === 'buy') {
        const cost = stock.price * amount;
        tax = Math.floor(cost * ECONOMY_CONFIG.transactionTaxRate);
        if (user.points < cost + tax) {
            console.error('Insufficient points:', { userPoints: user.points, cost, tax });
            return res.status(400).json({ success: false, message: 'เงินไม่พอ' });
        }

        // DCA calculation
        const prevQty = user.stocks[symbol] || 0;
        const prevAvg = user.stockAvgPrices[symbol] || stock.price;
        const totalOldCost = prevQty * prevAvg;
        const newCost = cost;
        user.stockAvgPrices[symbol] = (totalOldCost + newCost) / (prevQty + amount);

        user.points -= cost + tax;
        user.stocks[symbol] = prevQty + amount;

        user.markModified('stocks');
        user.markModified('stockAvgPrices');
        console.log('Buy successful:', { symbol, amount, newPoints: user.points, tax });
    } else if (action === 'sell') {
        if (!user.stocks[symbol] || user.stocks[symbol] < amount) {
            const ownedAmt = user.stocks[symbol] || 0;
            console.error('Insufficient stock:', { symbol, owned: ownedAmt, amount });
            return res.status(400).json({
                success: false,
                message: 'ไม่มีหุ้นนี้ในพอร์ตหรือจำนวนไม่พอ',
                details: { symbol, owned: ownedAmt, requested: amount }
            });
        }
        const revenue = stock.price * amount;
        tax = Math.floor(revenue * ECONOMY_CONFIG.transactionTaxRate);
        user.points += revenue - tax;
        user.stocks[symbol] -= amount;
        if (user.stocks[symbol] <= 0) {
            delete user.stocks[symbol];
            delete user.stockAvgPrices[symbol];
        }
        user.markModified('stocks');
        user.markModified('stockAvgPrices');
        console.log('Sell successful:', { symbol, amount, newPoints: user.points, tax });
    } else {
        console.error('Invalid action:', action);
        return res.status(400).json({ success: false, message: 'action ไม่ถูกต้อง' });
    }
    await user.save();

    // ✅ ส่งจำนวนหุ้นปัจจุบัน (หรือ 0 ถ้าขายหมดแล้ว)
    const stockQty = user.stocks[symbol] || 0;
    const responseObj = { success: true, newPoints: user.points, stockQty, stocks: user.stocks, stockAvgPrices: user.stockAvgPrices, tax: tax ?? 0 };
    console.log('Trade response being sent:', responseObj);
    res.json(responseObj);
});


app.get('/api/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const tokenParams = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI,
        });
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', tokenParams);
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
        });
        const { id, username, avatar } = userResponse.data;

        // ตรวจสอบว่าเป็นผู้เล่นใหม่หรือเก่า
        const existingUser = await User.findOne({ discordId: id });
        const isNewUser = !existingUser;

        // ตั้งค่าหุ้นเริ่มต้นสำหรับผู้เล่นใหม่
        const updateData = {
            username,
            avatar,
            lastLogin: Date.now()
        };

        if (isNewUser) {
            updateData.stocks = {
                BTC: 10,  // เริ่มต้นด้วย 10 Bitcoin
                ETH: 50   // เริ่มต้นด้วย 50 Ethereum
            };
        }

        const user = await User.findOneAndUpdate(
            { discordId: id },
            updateData,
            { upsert: true, returnDocument: 'after' }
        );
        res.redirect(`/?id=${user.discordId}`);
    } catch (error) { res.status(500).send('Auth Failed'); }
});

app.get('/api/user/:discordId', async (req, res) => {
    try {
        // อัปเดตรายได้ให้เป็นปัจจุบัน (ตามจำนวนคู่แข่งล่าสุด)
        const { finalPPS, competitorCounts } = await calculateDynamicPPS(req.params.discordId);
        const user = await User.findOne({ discordId: req.params.discordId });
        if (!user) return res.status(404).json({ message: "User not found" });

        // คำนวณรายได้ออฟไลน์ (anti-inflation safeguards)
        const now = new Date();
        const lastLoginTime = user.lastLogin ? new Date(user.lastLogin).getTime() : now.getTime();
        const diffSeconds = Math.max(0, Math.floor((now.getTime() - lastLoginTime) / 1000));

        let offlineEarnings = 0;
        let interestGain = 0;
        let upkeepDeduct = 0;
        // ถ้าออฟไลน์ไปเกิน 5 วินาทีและมีรายได้ ให้คำนวณย้อนหลัง
        if (diffSeconds > 5 && finalPPS > 0) {
            const cappedSeconds = Math.min(diffSeconds, ECONOMY_CONFIG.offlineMaxHours * 3600);
            const elapsedHours = cappedSeconds / 3600;

            // offline earnings with decay
            offlineEarnings = Math.floor(cappedSeconds * finalPPS * ECONOMY_CONFIG.offlineMultiplier);

            // cap by per-hour ceiling
            const maxHourly = Math.max(finalPPS * 3600 * ECONOMY_CONFIG.offlineHourlyCeilingFactor, 0);
            const maxAllowed = Math.floor(elapsedHours * maxHourly);
            if (offlineEarnings > maxAllowed) offlineEarnings = maxAllowed;

            // interest gain on balance
            interestGain = Math.floor(user.points * ECONOMY_CONFIG.interestRatePerHour * elapsedHours);
            user.points += offlineEarnings + interestGain;

            // wealth upkeep tax
            if (user.points > ECONOMY_CONFIG.wealthThreshold) {
                const excess = user.points - ECONOMY_CONFIG.wealthThreshold;
                upkeepDeduct = Math.floor(excess * ECONOMY_CONFIG.upkeepRatePerHour * elapsedHours);
                const maxUpkeep = Math.floor(excess * 0.5);
                if (upkeepDeduct > maxUpkeep) upkeepDeduct = maxUpkeep;
                if (upkeepDeduct > 0) user.points = Math.max(0, user.points - upkeepDeduct);
            }
        }

        // อัปเดตเวลาล่าสุด
        user.lastLogin = now;
        await user.save();

        // ส่งข้อมูลผู้เล่นพร้อมสถิติคู่แข่ง และ portfolio หุ้น
        const marketStage = await determineMarketStage();
        res.json({
            ...user._doc,
            pointsPerSecond: finalPPS,
            competitorCounts,
            stocks: user.stocks || {},
            stockAvgPrices: user.stockAvgPrices || {},
            currentStockPrices: STOCK_PRICES,
            marketStage,                     // ส่ง stage ให้หน้า UI
            offlineEarnings: offlineEarnings, // ส่งข้อมูลไปให้ Client แสดง Alert
            interestGain: interestGain,
            upkeepDeduct: upkeepDeduct
        });
    } catch (err) { res.status(500).send(err); }
});

app.post('/api/buy', async (req, res) => {
    const { discordId, upgradeType } = req.body;
    try {
        const user = await User.findOne({ discordId });
        if (!user) return res.status(404).json({ success: false });
        const item = BUSINESS_SHOP[upgradeType];
        if (!item) return res.status(400).json({ success: false, message: 'ประเภทไม่ถูกต้อง' });

        // support buying multiple levels (quantity) in the future - default 1
        const quantity = Math.max(1, parseInt(req.body.quantity) || 1);

        user.upgradeCounts = user.upgradeCounts || {};
        const currentCount = Number(user.upgradeCounts[upgradeType] || 0);

        // progressive cost formula: price increases by multiplier r per existing unit (e.g., r=1.15)
        const r = 1.15;
        // sum costs by iterating (safe for integer quantities)
        let totalCost = 0;
        for (let i = 0; i < quantity; i++) {
            const costForThis = Math.floor(item.cost * Math.pow(r, currentCount + i));
            totalCost += costForThis;
        }

        // apply transaction tax
        const tax = Math.floor(totalCost * ECONOMY_CONFIG.transactionTaxRate);
        const totalWithTax = totalCost + tax;
        if (user.points < totalWithTax) {
            return res.status(400).json({ success: false, message: `เงินไม่พอ (ต้องมีอย่างน้อย ฿${totalWithTax.toLocaleString()} รวมค่าธรรมเนียม)` });
        }

        // Deduct cost+tax and increment count
        user.points -= totalWithTax;
        user.upgradeCounts[upgradeType] = currentCount + quantity;
        // keep legacy array for single-purchase UI compatibility (ensure unique presence)
        if (!user.upgrades.includes(upgradeType)) user.upgrades.push(upgradeType);

        user.markModified('upgradeCounts');
        await user.save();

        // Recalculate PPS
        await calculateDynamicPPS(discordId);

        res.json({ success: true, newPoints: user.points, upgradeCounts: user.upgradeCounts, costPaid: totalCost, tax, totalWithTax });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/lottery', async (req, res) => {
    const { discordId, tier } = req.body;
    try {
        const user = await User.findOne({ discordId });
        if (!user) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

        const config = LOTTERY_CONFIG[tier];
        if (!config) return res.status(400).json({ success: false, message: 'ประเภทไม่ถูกต้อง' });

        if (user.points < config.price) {
            return res.status(400).json({ success: false, message: `แต้มไม่พอ! ขาดอีก ฿${(config.price - user.points).toLocaleString()}` });
        }

        user.points -= config.price;

        const roll = Math.random();
        let result = { name: "เสียใจด้วย", icon: "💨", amount: 0 };
        for (const prize of config.pool) {
            if (roll <= prize.threshold) {
                result = { name: prize.name, icon: prize.icon, amount: prize.amount };
                break;
            }
        }

        // apply tax on winnings
        const tax = Math.floor(result.amount * ECONOMY_CONFIG.transactionTaxRate);
        const netAmount = result.amount - tax;
        if (netAmount > 0) user.points += netAmount;
        await user.save();

        res.json({
            success: true,
            item: { name: result.name, icon: result.icon, winAmount: result.amount, tax },
            newPoints: user.points,
            ticketPricePaid: config.price,
            color: config.color
        });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- Save Progress API ---
app.post('/api/save', async (req, res) => {
    const { discordId, points, stocks, pointsPerSecond } = req.body;

    try {
        // 1. ตรวจสอบข้อมูลเบื้องต้นที่ส่งมา
        if (!discordId) {
            return res.status(400).json({ success: false, message: "Missing Discord ID" });
        }

        // 2. ป้องกันกรณีแต้มเป็นค่าว่างหรือติดลบ
        const pointsToSave = (points !== undefined && points >= 0) ? Number(points) : null;
        if (pointsToSave === null) {
            return res.status(400).json({ success: false, message: "Invalid points value" });
        }

        // 3. เตรียม update object
        const updateFields = {
            points: pointsToSave,
            lastLogin: Date.now()
        };
        if (stocks && typeof stocks === 'object') {
            updateFields.stocks = stocks;
        }
        if (pointsPerSecond !== undefined && Number(pointsPerSecond) >= 0) {
            updateFields.pointsPerSecond = Number(pointsPerSecond);
        }

        // --- Anti-cheat / anti-inflation check for client-submitted points ---
        const serverUser = await User.findOne({ discordId });
        if (!serverUser) return res.status(404).json({ success: false, message: 'User not found' });

        // calculate allowed gain since last login according to server-side PPS
        const nowMs = Date.now();
        const lastLoginMs = serverUser.lastLogin ? new Date(serverUser.lastLogin).getTime() : nowMs;
        const elapsedSec = Math.max(0, Math.floor((nowMs - lastLoginMs) / 1000));
        const allowedGain = Math.floor(elapsedSec * (serverUser.pointsPerSecond || 0) * 1.15); // 15% tolerance

        // clamp or reject large jumps: if client reports more than serverUser.points + allowedGain, clamp to safe value
        const maxAcceptable = Math.floor(serverUser.points + allowedGain + 0); // no extra bonus
        if (pointsToSave > maxAcceptable) {
            // clamp to maxAcceptable to avoid artificially inflating currency
            updateFields.points = maxAcceptable;
        }

        // prevent downward overwrite from stale client data
        // หาก client ส่งข้อมูลแต้มต่ำกว่าที่มีอยู่ (เช่น หน้าเก่าก่อนได้รับ offline earnings)
        // อย่าให้ค่าเงินลดลงแบบไม่จำเป็น เราจะเก็บค่าที่เซิร์ฟเวอร์ไว้
        if (pointsToSave < serverUser.points) {
            updateFields.points = serverUser.points;
        }

        const updatedUser = await User.findOneAndUpdate(
            { discordId: discordId },
            { $set: updateFields },
            { returnDocument: 'after' }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // 4. ส่งสถานะสำเร็จกลับไป
        res.json({
            success: true,
            message: "Progress saved",
            lastSavedPoints: updatedUser.points
        });

    } catch (err) {
        console.error("❌ Save Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const topPlayers = await User.find()
            .sort({ points: -1 })
            .limit(10)
            .select('username points avatar discordId popularity');
        res.json(topPlayers);
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/reset', async (req, res) => {
    const { discordId } = req.body;
    try {
        await User.findOneAndUpdate(
            { discordId },
            { $set: {
                points: 0,
                pointsPerSecond: 0,
                upgrades: [],
                upgradeCounts: {},
                popularity: 0,
                donationTotal: 0,
                stocks: {},
                stockAvgPrices: {},
                lastLogin: new Date() // ✅ อัปเดต lastLogin เพื่อไม่ให้ได้รายได้ออฟไลน์ทันที
            } },
            { returnDocument: 'after' }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// debug helper: create a test user on startup if requested
if (process.env.CREATE_TEST_USER) {
    const testId = process.env.TEST_USER_ID || 'test-player';
    console.log('🧪 Creating/updating test user:', testId);
    User.findOneAndUpdate(
        { discordId: testId },
        {
            discordId: testId,
            username: 'TestPlayer',
            avatar: '',
            points: 100000,
            pointsPerSecond: 10,
            upgrades: [],
            upgradeCounts: {},
            popularity: 0,
            donationTotal: 0,
            lastLogin: Date.now()
        },
        { upsert: true, setDefaultsOnInsert: true }
    ).then(u => {
        if (u) {
            console.log('✅ Test user ready', u.discordId);
        } else {
            console.log('⚠️ test user creation returned null (upsert may have failed)');
        }
    }).catch(e => console.error('❌ failed to create test user', e));
}

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// expose models for auxiliary scripts/tests
module.exports = { User };


// GET: OHLC data (proxy to Yahoo Finance). Returns array of {time, open, high, low, close}
app.get('/api/stock/ohlc/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const range = req.query.range || '1d';
    const interval = req.query.interval || '5m';

    // map internal symbols to Yahoo symbols when needed
    const map = { BTC: 'BTC-USD', ETH: 'ETH-USD' };
    const yfSymbol = map[symbol] || symbol;

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?range=${range}&interval=${interval}`;
        const r = await axios.get(url, { timeout: 8000 });
        const result = r.data?.chart?.result?.[0];
        if (!result) return res.status(404).json({ success: false, message: 'No chart data' });

        const timestamps = result.timestamp || [];
        const indicators = result.indicators?.quote?.[0] || {};
        const opens = indicators.open || [];
        const highs = indicators.high || [];
        const lows = indicators.low || [];
        const closes = indicators.close || [];

        const data = timestamps.map((t, i) => {
            const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
            if (o == null || h == null || l == null || c == null) return null;
            return { time: t, open: Number(o), high: Number(h), low: Number(l), close: Number(c) };
        }).filter(Boolean);

        // fallback to simple synthetic data if Yahoo returns nothing
        if (!data.length) {
            const history = STOCK_HISTORY[symbol] || [];
            if (!history.length) return res.json({ symbol, data: [] });

            const fallback = [];

            // ใช้เวลาล่าสุด ปัดเศษเป็นหลัก 5 นาที เพื่อให้แท่งเทียนต่อกันสวยงาม (300 วินาที = 5 นาที)
            const now = Math.floor(Date.now() / 1000);
            const coeff = 1000 * 60 * 5;
            const roundedNow = Math.floor((Math.round(Date.now() / coeff) * coeff) / 1000);

            for (let i = 0; i < history.length; i++) {
                // สร้างแท่งเทียนจำลองจากราคาใน History ทำให้ต่อเนื่อง ไม่มั่ว
                const close = history[i];
                const open = i === 0 ? close : history[i - 1];

                // สุ่ม high/low จาก open กับ close แบบไม่เวอร์มาก (±2%)
                const high = Math.max(open, close) * (1 + Math.random() * 0.02);
                const low = Math.min(open, close) * (1 - Math.random() * 0.02);

                fallback.push({
                    time: roundedNow - ((history.length - 1 - i) * 300), // ถอยหลังทีละ 5 นาที
                    open,
                    high,
                    low,
                    close
                });
            }
            return res.json({ symbol, data: fallback });
        }

        res.json({ symbol, data });
    } catch (err) {
        console.error('OHLC proxy error for', symbol, err.message || err);
        res.status(500).json({ success: false, message: 'Failed to fetch OHLC data', error: err.message });
    }
});
