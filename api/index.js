// api/index.js

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * دالة عامة لإرسال طلب إلى Supabase REST API.
 * @param {string} table - اسم الجدول.
 * @param {string} method - طريقة HTTP (GET, POST, PATCH, DELETE).
 * @param {object|null} body - جسم الطلب للإرسال (POST/PATCH).
 * @param {string} filter - سلاسل استعلام تصفية إضافية (مثل: 'select=*&id=eq.1').
 * @returns {Promise<Response>} - كائن الاستجابة من Fetch.
 */
async function call(table, method, body, filter = "") {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error('Supabase environment variables are not set.');
    }

    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    if (filter) {
        url += `?${filter}`;
    }

    const headers = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    };

    const config = {
        method: method.toUpperCase(),
        headers: headers,
        body: body ? JSON.stringify(body) : null
    };

    return fetch(url, config);
}

/**
 * معالج الطلبات الرئيسي لـ Vercel Serverless Function.
 */
module.exports = async function handler(req, res) {
    // 1. دعم CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // الرد على طلبات OPTIONS (لـ CORS Preflight)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // يجب أن يكون الطلب POST
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method Not Allowed. Only POST is supported.' });
    }

    let body;
    try {
        // دعم JSON input
        body = req.body;
        if (!body) {
             // محاولة قراءة الجسم إذا لم يكن متاحًا بشكل مباشر (قد يحدث في بعض البيئات)
             body = await new Promise((resolve, reject) => {
                let data = '';
                req.on('data', chunk => data += chunk);
                req.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Invalid JSON input'));
                    }
                });
                req.on('error', reject);
            });
        }
    } catch (e) {
        return res.status(400).json({ ok: false, error: 'Invalid JSON format.' });
    }
    
    // التحقق الأساسي من الـ Body والأكشن
    if (!body || typeof body !== 'object') {
        return res.status(400).json({ ok: false, error: 'Request body is missing or invalid.' });
    }

    const { userId, action, ...payload } = body;

    if (!action) {
        return res.status(400).json({ ok: false, error: 'Action field is required in the request body.' });
    }
    
    // تسجيل الأكشن في Supabase
    try {
        const logEntry = {
            action: action,
            user_id: userId || null, // يمكن أن يكون userId مفقودًا أو null
            payload: payload
        };
        // لا نحتاج للانتظار لتسجيل السجل لإكمال الأكشن، لكن نسجّله
        const logRes = await call('actions_log', 'POST', logEntry, 'select=id');
        if (logRes.status !== 201) {
            console.error(`Failed to log action ${action}:`, await logRes.text());
        }
    } catch (e) {
        console.error(`Supabase logging error for ${action}:`, e.message);
        // لا نوقف العملية الرئيسية بسبب فشل التسجيل
    }

    // معالجة الأكشن بناءً على الـ Switch Case
    try {
        switch (action) {
            case 'play':
                // من index.html: api({userId:1,action:'play'}).catch(console.error);
                // لا يوجد منطق backend معقد مطلوب هنا، فقط الرد بنجاح.
                return res.status(200).json({ ok: true, message: 'Game start signal acknowledged.' });

            case 'openTasks':
                // من index.html: api({userId:1,action:'openTasks'}).catch(console.error);
                return res.status(200).json({ ok: true, message: 'Open tasks page acknowledged.' });

            case 'openAddTask':
                // من index.html: api({userId:1,action:'openAddTask'}).catch(console.error);
                return res.status(200).json({ ok: true, message: 'Open add task page acknowledged.' });

            case 'openSwap':
                // من index.html: api({userId:1,action:'openSwap'}).catch(console.error);
                return res.status(200).json({ ok: true, message: 'Open swap page acknowledged.' });

            case 'openWithdraw':
                // من index.html: api({userId:1,action:'openWithdraw'}).catch(console.error);
                return res.status(200).json({ ok: true, message: 'Open withdraw page acknowledged.' });

            case 'swap':
                // من index.html: api({userId:1,action:'swap',amount})
                // يجب تطبيق منطق معالجة Swap هنا: التحقق من الرصيد وتحديثه.
                const { amount } = payload;
                if (!amount || typeof amount !== 'number' || amount <= 0) {
                    return res.status(400).json({ ok: false, error: 'Invalid swap amount.' });
                }
                // مثال: تحديث رصيد المستخدم في جدول المستخدمين (نحن لا نملك هذا الجدول، لذا نرد بنجاح افتراضي)
                return res.status(200).json({ ok: true, message: `Swapped ${amount} score for USDT.` });

            case 'joinChannel':
                // من index.html: api({userId:1,action:'joinChannel',ticketLeft}).catch(console.error);
                const { ticketLeft: tL } = payload;
                // مثال: التحقق من أن القناة انضمت وتحديث عدد التذاكر.
                return res.status(200).json({ ok: true, message: `Joined channel and updated tickets to ${tL}.` });

            case 'watchAd':
                // من index.html: api({userId:1,action:'watchAd',ticketLeft,adsLeft}).catch(console.error);
                const { ticketLeft: tL2, adsLeft } = payload;
                // مثال: التحقق من مشاهدة الإعلان وتحديث العدادات.
                return res.status(200).json({ ok: true, message: `Watched ad, tickets: ${tL2}, ads left: ${adsLeft}.` });

            case 'back':
                // من index.html: api({userId:1,action:'back'}).catch(console.error);
                return res.status(200).json({ ok: true, message: 'Back action acknowledged.' });

            case 'collect':
                // من index.html: api({userId:1,action:'collect',emoji:elem.textContent,totalScore}).catch(console.error);
                const { emoji, totalScore } = payload;
                // مثال: التحقق من الإيموجي وتحديث النتيجة.
                return res.status(200).json({ ok: true, message: `Collected ${emoji}, new score: ${totalScore}.` });

            case 'joinCommunityTask':
                // من index.html: api({userId:1,action:'joinCommunityTask',taskName:name}).catch(console.error);
                const { taskName } = payload;
                // مثال: تسجيل انضمام المستخدم للمهمة.
                return res.status(200).json({ ok: true, message: `Joined community task: ${taskName}.` });

            // إضافة أي أكشنات أخرى إذا وجدت
            default:
                return res.status(404).json({ ok: false, error: `Unknown action: ${action}` });
        }
    } catch (error) {
        // معالجة الأخطاء الداخلية
        console.error('Action processing error:', error);
        return res.status(500).json({ ok: false, error: error.message || 'Internal Server Error during action processing.' });
    }
};