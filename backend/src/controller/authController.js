const userModel = require('../model/userModel.js');
const shopModel = require('../model/shopModel.js');
const jwt = require('jsonwebtoken');
const { Resend } = require("resend");
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey && !['change_me', ''].includes(resendApiKey)
    ? new Resend(resendApiKey)
    : null;
const bcrypt = require('../utils/bcrypt.js');
const SECRET_KEY = process.env.SECRET_KEY;

async function login(req, res) {
    try {
        const { username, password } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({ error: 'username and password are required' });
        }

        const user = await userModel.findOne({ username });
        if (!user) return res.status(401).json({ error: 'Invalid username or password' });

        const passwordCheck = await bcrypt.comparePassword(password, user.password);
        if (!passwordCheck) return res.status(401).json({ error: 'Invalid username or password' });
        if (user.isActive === false) {
            return res.status(401).json({ error: 'Account is inactive' });
        }
        const token = jwt.sign(
            { username: user.username, role: user.role },
            SECRET_KEY,
            { expiresIn: '8h' }
        );

        res.status(200).json({ message: 'Login successful', role: user.role, token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function register(req, res) {
    try {
        const { username, password, email, phone, shop_name, shop_address, open_time, close_time } = req.body;

        if (!username || !password || !email || !phone || !shop_name || !shop_address) {
            return res.status(400).json({ error: 'missing required fields' });
        }

        const checkUser = await userModel.findOne({ username });
        if (checkUser) {
            return res.status(409).json({ error: 'User already exists' });
        }
        const checkEmail = await userModel.findOne({ email });
        if (checkEmail) {
            return res.status(409).json({ error: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hashPassword(password);

        const shop = await shopModel.create({
            shop_name,
            shop_address,
            open_time: open_time || "08:00",
            close_time: close_time || "22:00",
            tax_enabled: true,
            tax_rate: 7,
            service_charge_enabled: false,
            service_charge_rate: 10,
            tables: [],
            menu_category: {
                food: [],
                drink: [],
                dessert: [],
                other: []
            },
            create_at: new Date(),
        });

        const user = await userModel.create({
            username,
            password: hashedPassword,
            role: "owner",
            email,
            phone,
            shop_id: shop._id,
            isActive: true,
            create_at: new Date()
        });

        const token = jwt.sign(
            { username: username, role: "owner" },
            SECRET_KEY,
            { expiresIn: '8h' }
        );

        res.status(201).json({
            message: 'User and shop created successfully',
            role: user.role,
            token
        });
    } catch (err) {
        // console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////

let otpStore = {};

async function forgotPassword(req, res) {
    try {
        if (!resend) {
            return res.status(503).json({
                error: 'Password reset email service is not configured',
                hint: 'Set RESEND_API_KEY to enable password reset emails'
            });
        }
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email is required" });

        const user = await userModel.findOne({ $or: [{ email: email, username: email }] });
        if (!user) return res.status(404).json({ error: "User not found" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expireTime = Date.now() + 5 * 60 * 1000; // 5 เธเธฒเธ—เธต
        otpStore[email] = { code: otp, expire: expireTime };
        console.log(email);

        await resend.emails.send({
            from: "Shop POS <onboarding@resend.dev>",
            to: email,
            subject: "Your OTP Code",
            html: `
    <div style="font-family:Arial;padding:20px;">
      <h2>๐”’ Shop POS Password Reset</h2>
      <p>เธชเธงเธฑเธชเธ”เธต ${user.username},</p>
      <p>เธเธตเนเธเธทเธญเธฃเธซเธฑเธช OTP เธเธญเธเธเธธเธ“:</p>
      <h1 style="color:#4f46e5;">${otp}</h1>
      <p>เธฃเธซเธฑเธชเธเธตเนเธเธฐเธซเธกเธ”เธญเธฒเธขเธธเนเธ 5 เธเธฒเธ—เธต</p>
      <hr>
      <p style="font-size:12px;color:gray;">เธซเธฒเธเธเธธเธ“เนเธกเนเนเธ”เนเธเธญเน€เธเธฅเธตเนเธขเธเธฃเธซเธฑเธชเธเนเธฒเธ เนเธเธฃเธ”เธฅเธฐเน€เธงเนเธเธญเธตเน€เธกเธฅเธเธตเน</p>
    </div>
  `,
        });


        res.status(200).json({ message: "OTP sent successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to send OTP email" });
    }
}


async function verifyOtp(req, res) {
    try {
        const { email, otp } = req.body;
        if (!otpStore[email]) return res.status(400).json({ error: 'OTP not found or expired' });

        const { code, expire } = otpStore[email];
        if (Date.now() > expire) {
            delete otpStore[email];
            return res.status(400).json({ error: 'OTP expired' });
        }

        if (otp !== code) return res.status(400).json({ error: 'Invalid OTP' });

        res.status(200).json({ message: 'OTP verified successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'OTP verification failed' });
    }
}


async function resetPassword(req, res) {
    try {
        const { email, newPassword } = req.body;
        if (!email || !newPassword)
            return res.status(400).json({ error: 'Email and new password are required' });

        if (!otpStore[email])
            return res.status(400).json({ error: 'OTP not verified or expired' });

        const hashed = await bcrypt.hashPassword(newPassword);
        await userModel.findOneAndUpdate(
            { email },
            { password: hashed },
            { new: true }
        );

        delete otpStore[email];
        res.status(200).json({ message: 'Password reset successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Password reset failed' });
    }
}

module.exports = {
    login,
    register,
    forgotPassword,
    verifyOtp,
    resetPassword,
};
