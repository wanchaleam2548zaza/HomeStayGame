require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- 1. Database Connection ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 2. User Schema ---
const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: String,
    avatar: String,
    points: { type: Number, default: 0 },
    pointsPerSecond: { type: Number, default: 0 },
    upgrades: { type: [String], default: [] },
    lastLogin: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// --- 3. Game Data Config ---
const BUSINESS_SHOP = {
    coffee: { cost: 0, power: 5, name: "ร้านกาแฟสตาร์โบ๊ท" },
    repair: { cost: 0, power: 5, name: "ศูนย์ซ่อมมือถือด่วน" },
    vending: { cost: 0, power: 5, name: "ตู้น้ำหยอดเหรียญอัจฉริยะ" },
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

// --- Helper: คำนวณรายได้แบบมีคู่แข่ง ---
async function calculateDynamicPPS(discordId) {
    const user = await User.findOne({ discordId });
    if (!user) return 0;

    let totalPPS = 0;
    const competitorCounts = {}; // เก็บข้อมูลไว้แสดงผลหน้าบ้านด้วย

    for (const upgradeId of user.upgrades) {
        const config = BUSINESS_SHOP[upgradeId];
        if (config) {
            // นับจำนวนคนที่มีธุรกิจนี้ใน Database
            const count = await User.countDocuments({ upgrades: upgradeId });
            competitorCounts[upgradeId] = count;

            // สูตร: รายได้ฐาน / จำนวนคู่แข่ง
            const dynamicPower = count > 0 ? (config.power / count) : config.power;
            totalPPS += dynamicPower;
        }
    }

    const finalPPS = Number(totalPPS.toFixed(2));
    await User.updateOne({ discordId }, { $set: { pointsPerSecond: finalPPS } });
    return { finalPPS, competitorCounts };
}

// --- 4. API Routes ---

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
        const user = await User.findOneAndUpdate(
            { discordId: id },
            { username, avatar, lastLogin: Date.now() },
            { upsert: true, new: true }
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

        // ส่งข้อมูลผู้เล่นพร้อมสถิติคู่แข่ง
        res.json({ ...user._doc, pointsPerSecond: finalPPS, competitorCounts });
    } catch (err) { res.status(500).send(err); }
});

app.post('/api/buy', async (req, res) => {
    const { discordId, upgradeType } = req.body;
    try {
        const user = await User.findOne({ discordId });
        if (!user) return res.status(404).json({ success: false });
        if (user.upgrades.includes(upgradeType)) return res.status(400).json({ success: false, message: 'ครอบครองแล้ว' });

        const item = BUSINESS_SHOP[upgradeType];
        if (user.points >= item.cost) {
            user.points -= item.cost;
            user.upgrades.push(upgradeType);
            await user.save();
            
            // ซื้อเสร็จให้คำนวณรายได้ใหม่ทันที
            await calculateDynamicPPS(discordId);
            
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, message: 'เงินไม่พอ' });
        }
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

        user.points += result.amount;
        await user.save();

        res.json({
            success: true,
            item: { name: result.name, icon: result.icon, winAmount: result.amount },
            newPoints: user.points,
            ticketPricePaid: config.price,
            color: config.color
        });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- Save Progress API ---
app.post('/api/save', async (req, res) => {
    const { discordId, points } = req.body;

    try {
        // 1. ตรวจสอบข้อมูลเบื้องต้นที่ส่งมา
        if (!discordId) {
            return res.status(400).json({ success: false, message: "Missing Discord ID" });
        }

        // 2. ป้องกันกรณีแต้มเป็นค่าว่างหรือติดลบ (ป้องกันบัคเงินหาย)
        const pointsToSave = (points !== undefined && points >= 0) ? Number(points) : null;

        if (pointsToSave === null) {
            return res.status(400).json({ success: false, message: "Invalid points value" });
        }

        // 3. อัปเดตข้อมูลลง Database 
        // หมายเหตุ: เราไม่อัปเดต pointsPerSecond ที่นี่ เพราะ PPS ควรถูกคำนวณจากระบบคู่แข่งใน /api/user
        const updatedUser = await User.findOneAndUpdate(
            { discordId: discordId },
            { 
                $set: { 
                    points: pointsToSave,
                    lastLogin: Date.now() // อัปเดตเวลาที่ Active ล่าสุดเพื่อเช็ค Session
                } 
            },
            { new: true } // ให้คืนค่าข้อมูลที่อัปเดตแล้วกลับมา
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
            .select('username points avatar discordId');
        res.json(topPlayers);
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/reset', async (req, res) => {
    const { discordId } = req.body;
    try {
        await User.findOneAndUpdate(
            { discordId },
            { $set: { points: 0, pointsPerSecond: 0, upgrades: [] } }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});