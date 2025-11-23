// api/index.js

const express = require('express');
const cors = require('cors');

// قم بتحميل متغيرات البيئة إذا كنت تختبر محليًا
// في Vercel، يتم تحميلها تلقائيًا
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    // يمكنك إلغاء التعليق عن هذا السطر واستخدام مكتبة 'dotenv' إذا كنت تختبر محليًا
    // require('dotenv').config();
}

const app = express();

// إعداد Middleware
app.use(cors({
    origin: '*', // **هام:** في الإنتاج، يجب أن يكون هذا هو نطاق Mini App الخاص بك على Vercel
    methods: ['POST', 'GET'],
}));
app.use(express.json()); // تحليل JSON bodies

// ------------------- Supabase Configuration -------------------

// يتم تحميل هذه المتغيرات من إعدادات Vercel Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // مفتاح الخدمة السري (Service Role Key)
const TABLE_NAME = process.env.SUPABASE_TABLE_NAME || 'users';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("FATAL: SUPABASE_URL or SUPABASE_SERVICE_KEY not set. Check Vercel Environment Variables.");
}

// ------------------- Supabase REST Helper -------------------

// دالة مساعدة لإرسال الطلبات إلى Supabase REST API
async function supabaseRequest(method, endpoint, body = null, headers = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    
    const defaultHeaders = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`, // استخدام مفتاح الخدمة
        ...headers
    };

    const config = {
        method: method,
        headers: defaultHeaders,
        body: body ? JSON.stringify(body) : undefined,
    };

    // استخدام دالة fetch المدمجة في Node.js
    const response = await fetch(url, config);
    
    if (!response.ok) {
        const errorDetails = await response.json().catch(() => ({ message: 'Unknown Supabase error' }));
        console.error(`Supabase Error (${method} ${url}):`, response.status, errorDetails);
        // رمي خطأ يحتوي على تفاصيل الخطأ لتسهيل التصحيح
        throw new Error(`Supabase API failed: ${response.status} - ${errorDetails.message || JSON.stringify(errorDetails)}`);
    }

    // Supabase REST API يرجع مصفوفة من الكائنات
    return response.json();
}

// ------------------- User Authentication and Fetching -------------------

// هذه الدالة تتحقق من وجود المستخدم وتنشئه إذا لم يكن موجودًا
async function verifyUser(req, res, next) {
    // **ملاحظة أمان:** في الإنتاج، يجب استخراج initData من طلب Telegram
    // والتحقق من صلاحيتها قبل استخدام userId.
    const userId = req.body.userId; 
    
    if (!userId) {
         return res.status(401).json({ error: 'User ID is required for authentication.' });
    }
    
    req.userId = userId;

    try {
        // 1. جلب المستخدم: البحث عن المستخدم بناءً على Telegram ID (عمود 'id')
        const data = await supabaseRequest('GET', `${TABLE_NAME}?id=eq.${userId}&select=*`);

        // 2. إذا لم يتم العثور على المستخدم، قم بإنشائه
        if (data.length === 0) {
            const newUser = {
                id: userId,
                total_score: 0,
                ticket_left: 5, // إعطاء 5 تذاكر مبدئية
                usdt_balance: 0.0,
                ads_left: 300,
                is_joined: false,
                binance_uid: null,
            };
            const createdUser = await supabaseRequest('POST', `${TABLE_NAME}`, newUser, {
                'Prefer': 'return=representation' // يطلب إرجاع الكائن الذي تم إنشاؤه
            });
            req.user = createdUser[0];
        } else {
            // 3. تم العثور على المستخدم
            req.user = data[0];
        }
        
        next();
    } catch (error) {
        console.error('User verification failed:', error.message);
        res.status(500).json({ error: 'Failed to fetch or initialize user data.' });
    }
}

// ------------------- Main API Logic -------------------

// المسار الرئيسي لاستقبال جميع طلبات الـ API
app.post('/api', verifyUser, async (req, res) => {
    const { action, amount, totalScore, ticketLeft, adsLeft, binance, withdrawAmount, taskName } = req.body;
    const user = req.user; 
    const userId = req.userId;
    
    let updatePayload = {};
    let responseData = { status: 'Success', userId: userId };

    try {
        switch (action) {
            case 'play':
                // يتم إرسال ticketLeft الجديد بعد خصم التذكرة من الـ frontend
                updatePayload.ticket_left = ticketLeft;
                responseData.newTicketCount = ticketLeft;
                break;

            case 'collect':
                // يتم إرسال totalScore المحدث من الـ frontend
                updatePayload.total_score = totalScore;
                responseData.newScore = totalScore;
                break;

            case 'swap':
                const scoreToSwap = parseInt(amount);
                const minSwap = 200000;
                
                if (scoreToSwap < minSwap || scoreToSwap > user.total_score) {
                    return res.status(400).json({ error: `Minimum swap is ${minSwap} score or insufficient score` });
                }
                
                // حساب التحويل (200,000 نقطة = 0.01 USDT)
                const usdtGained = (scoreToSwap * 0.01 / 200000); 
                const newScore = user.total_score - scoreToSwap;
                const newUsdt = user.usdt_balance + usdtGained;

                updatePayload.total_score = newScore;
                updatePayload.usdt_balance = newUsdt;

                responseData.newScore = newScore;
                responseData.newUsdt = newUsdt.toFixed(6);
                break;
                
            case 'joinChannel':
                updatePayload.ticket_left = ticketLeft;
                updatePayload.is_joined = true;
                responseData.tickets = ticketLeft;
                break;
                
            case 'watchAd':
                updatePayload.ticket_left = ticketLeft;
                updatePayload.ads_left = adsLeft;
                responseData.tickets = ticketLeft;
                responseData.adsLeft = adsLeft;
                break;
                
            case 'withdraw':
                if (withdrawAmount < 0.03 || withdrawAmount > user.usdt_balance) {
                    return res.status(400).json({ error: 'Invalid amount or insufficient balance' });
                }
                
                // تحديث الرصيد وحفظ UID
                updatePayload.usdt_balance = user.usdt_balance - withdrawAmount;
                updatePayload.binance_uid = binance;
                
                responseData.remainingUsdt = updatePayload.usdt_balance.toFixed(6);
                responseData.status = 'Withdraw request sent, processing...';
                
                // **منطق خارجي:** هنا يجب استدعاء نظام الإشعار أو الدفع الفعلي.
                break;

            case 'joinCommunityTask':
                // يمكن حفظ سجل الانضمام في جدول منفصل إذا لزم الأمر
                responseData.status = `Joined task: ${taskName}`;
                break;
                
            case 'getStats':
                // جلب بيانات المستخدم المحدثة بعد العمليات
                return res.json({
                    status: 'Stats fetched',
                    totalScore: user.total_score,
                    ticketLeft: user.ticket_left,
                    usdt: user.usdt_balance.toFixed(6),
                    adsLeft: user.ads_left,
                    joined: user.is_joined,
                });


            case 'openTasks':
            case 'openAddTask':
            case 'openSwap':
            case 'openWithdraw':
            case 'back':
                // لا يوجد تحديث لقاعدة البيانات لهذه الإجراءات
                return res.json({ status: 'Page view acknowledged' });

            default:
                return res.status(400).json({ error: 'Unknown action' });
        }

        // تنفيذ طلب التحديث (PATCH) إلى Supabase إذا كان هناك حمولة لتحديثها
        if (Object.keys(updatePayload).length > 0) {
            await supabaseRequest('PATCH', `${TABLE_NAME}?id=eq.${userId}`, updatePayload, {
                'Prefer': 'return=minimal' 
            });
        }

        return res.json(responseData);
        
    } catch (error) {
        console.error('API Processing Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

// تصدير التطبيق ليتم استخدامه كـ Serverless Function في Vercel
module.exports = app;

// يمكن إضافة تشغيل محلي للاختبار
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const PORT = 3000;
    app.listen(PORT, () => {
        console.log(`Development Server running on http://localhost:${PORT}/api`);
        console.log("To run locally, you need 'express', 'cors', and optionally 'dotenv' installed.");
    });
}