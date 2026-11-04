// ============================================
// supabase-api.js
// Replaces every old *.php endpoint. rsmApi('get_products.php') behaves like fetch()
// (returns { ok, status, json() }) and gives back the same JSON the PHP script did,
// so the page scripts keep working. window.rsmAuth holds login / logout / reset helpers.
// ============================================
(function () {
    const cfg = window.RSM_CONFIG || {};
    const sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    window.rsmSupabase = sb;

    const BRANCHES = ['Alangilan', 'Sta Teresita', 'Mabini Lipa', 'San Luis'];
    const BRANCH_KEY = 'rsm_admin_branch';
    const SERVER_ERROR = 'Server error. Please try again.';

    const respond = (data, status) => {
        const code = status ?? data?.status ?? (data && data.success === false ? 400 : 200);
        return { ok: code < 400, status: code, json: async () => data };
    };
    const fail = (message, status = 400) => respond({ success: false, message }, status);

    function adminBranch() {
        try {
            const b = localStorage.getItem(BRANCH_KEY);
            return b === 'all' || BRANCHES.includes(b) ? b : 'all';
        } catch (e) { return 'all'; }
    }

    // Normalise whatever the page passed as a request body into a plain object.
    function readBody(body) {
        if (!body) return {};
        if (typeof body === 'string') { try { return JSON.parse(body); } catch (e) { return {}; } }
        if (body instanceof FormData) {
            const out = {};
            body.forEach((v, k) => { out[k] = v; });
            return out;
        }
        if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
        return body;
    }

    async function rpc(name, args) {
        const { data, error } = await sb.rpc(name, args || {});
        if (error) {
            console.error(name, error);
            return fail(SERVER_ERROR, 500);
        }
        return respond(data);
    }

    async function hasSession() {
        const { data } = await sb.auth.getSession();
        return !!data.session;
    }

    // ---------- payment proof storage ----------
    const PROOF_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

    async function uploadProof(file) {
        if (!file || !file.size) throw new Error('Please upload a valid proof of payment.');
        if (file.size > 5 * 1024 * 1024) throw new Error('The proof image must be smaller than 5 MB.');
        const ext = PROOF_TYPES[file.type];
        if (!ext) throw new Error('Proof of payment must be a JPG, PNG, or WebP image.');
        const { data: u } = await sb.auth.getUser();
        if (!u.user) throw new Error('Please log in before placing an order.');
        const rand = crypto.getRandomValues(new Uint8Array(16));
        const name = Array.from(rand, b => b.toString(16).padStart(2, '0')).join('');
        const path = `${u.user.id}/${name}.${ext}`;
        const { error } = await sb.storage.from('payment-proofs').upload(path, file, { contentType: file.type });
        if (error) throw new Error('Could not store the proof image. Please try again.');
        return path;
    }
    const removeProof = (path) => path ? sb.storage.from('payment-proofs').remove([path]).catch(() => {}) : null;

    // ---------- 7-day forecast (port of the PHP linear regression) ----------
    function linearForecast(series) {
        const n = series.length;
        if (n === 0) return new Array(7).fill(0);
        if (n === 1) return new Array(7).fill(series[0]);
        const meanX = (n - 1) / 2;
        const meanY = series.reduce((a, b) => a + b, 0) / n;
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) {
            num += (i - meanX) * (series[i] - meanY);
            den += (i - meanX) * (i - meanX);
        }
        const slope = den === 0 ? 0 : num / den;
        const intercept = meanY - slope * meanX;
        const out = [];
        for (let k = 1; k <= 7; k++) out.push(Math.max(0, intercept + slope * (n - 1 + k)));
        return out;
    }
    const pad2 = (n) => String(n).padStart(2, '0');
    const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

    function addForecast(data) {
        const history = data.daily_history || {};
        const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 27);
        data.forecast_products = (data.forecast_products || []).map(p => {
            const byDay = history[String(p.product_id)] || {};
            const series = [];
            for (let i = 0; i < 28; i++) {
                const d = new Date(start); d.setDate(start.getDate() + i);
                series.push(Number(byDay[ymd(d)] || 0));
            }
            const sum = (a) => a.reduce((x, y) => x + y, 0);
            const projected = linearForecast(series);
            const forecastUnits = Math.round(sum(projected));
            return {
                ...p,
                historical_units: Math.trunc(sum(series)),
                recent_units: Math.trunc(sum(series.slice(-7))),
                previous_units: Math.trunc(sum(series.slice(-14, -7))),
                forecast_units: forecastUnits,
                restock_units: Math.max(0, forecastUnits - Number(p.stock_qty)),
                forecast_series: projected.map(v => Math.trunc(v)),
            };
        });
        delete data.daily_history;
        return data;
    }

    // ---------- route table ----------
    const routes = {
        // ----- public / customer -----
        'get_products.php': () => rpc('rsm_get_products'),

        'cart.php': async (o) => {
            if (!(await hasSession())) return fail('Please log in to save your cart.', 401);
            if ((o.method || 'GET').toUpperCase() === 'GET') return rpc('rsm_get_cart');
            return rpc('rsm_save_cart', { p_items: readBody(o.body).items });
        },

        'customer_account.php': async (o) => {
            if (!(await hasSession())) return fail('Please log in to view your account details.', 401);
            if ((o.method || 'GET').toUpperCase() === 'GET') return rpc('rsm_get_account');
            const f = readBody(o.body);
            const res = await rpc('rsm_update_account', {
                p_email: f.email, p_branch: f.branch, p_address: f.address, p_phone: f.phone,
            });
            const data = await res.json();
            if (data.success && data.email_changed) {
                const { error } = await sb.auth.updateUser({ email: String(f.email).trim() });
                if (error) {
                    const taken = /already|registered|exists/i.test(error.message || '');
                    return fail(taken ? 'That email is already registered.' : 'Could not update your email address.', taken ? 409 : 400);
                }
            }
            return res;
        },

        'place_order.php': async (o) => {
            if (!(await hasSession())) return fail('Please log in before placing an order.', 401);
            const f = readBody(o.body);
            const method = String(f.payment_method || '').trim().toLowerCase();
            let proofPath = null;
            try {
                if (method === 'gcash') {
                    if (!/^[A-Za-z0-9-]{6,80}$/.test(String(f.gcash_reference || '').trim())) {
                        return fail('Enter a valid GCash reference number.');
                    }
                    proofPath = await uploadProof(f.gcash_proof);
                }
            } catch (e) { return fail(e.message); }

            let cart = [];
            try { cart = JSON.parse(f.cart || '[]'); } catch (e) { cart = []; }
            const res = await rpc('rsm_place_order', {
                p_cart: cart, p_payment_method: method,
                p_gcash_reference: f.gcash_reference || null, p_proof_path: proofPath,
            });
            const data = await res.json();
            if (!data.success) await removeProof(proofPath);
            return res;
        },

        'get_order.php': async (o, q) => {
            if (!(await hasSession())) return fail('Please log in to view this order.', 401);
            return rpc('rsm_get_order', { p_order_id: Number(q.get('order_id')) || 0 });
        },

        'get_my_orders.php': async (o, q) => {
            if (!(await hasSession())) return fail('Please log in to view your orders.', 401);
            return rpc('rsm_get_my_orders', { p_tracking: q.get('tracking') === '1' });
        },

        'resubmit_payment_proof.php': async (o) => {
            if (!(await hasSession())) return fail('Please log in to update your payment proof.', 401);
            const f = readBody(o.body);
            let newPath;
            try { newPath = await uploadProof(f.gcash_proof); } catch (e) { return fail(e.message); }
            const res = await rpc('rsm_resubmit_payment_proof', {
                p_order_id: Number(f.order_id) || 0, p_reference: f.gcash_reference, p_proof_path: newPath,
            });
            const data = await res.json();
            if (!data.success) await removeProof(newPath);
            else await removeProof(data.old_proof_path);
            delete data.old_proof_path;
            return res;
        },

        // ----- staff -----
        'staff_orders.php': async () => {
            if (!(await hasSession())) return fail('Staff login required.', 401);
            const res = await rpc('rsm_staff_orders');
            const data = await res.json();
            if (data.success) {
                await Promise.all(data.orders.map(async (order) => {
                    if (order.proof_path) {
                        const { data: signed } = await sb.storage.from('payment-proofs')
                            .createSignedUrl(order.proof_path, 3600);
                        order.proof_url = signed ? signed.signedUrl : null;
                    }
                    delete order.proof_path;
                }));
            }
            return respond(data);
        },

        'staff_update_order.php': async (o) => {
            if (!(await hasSession())) return fail('Staff login required.', 401);
            const f = readBody(o.body);
            return rpc('rsm_staff_update_order', {
                p_order_id: Number(f.order_id) || 0, p_status: f.status || null,
                p_decision: f.payment_decision || null,
            });
        },

        // ----- admin -----
        'admin_branch_context_set.php': async (o) => {
            const me = await rpc('rsm_admin_me');
            if (me.status === 401) return me;
            const branch = readBody(o.body).branch;
            if (branch !== 'all' && !BRANCHES.includes(branch)) return fail('Choose a valid branch.', 422);
            try { localStorage.setItem(BRANCH_KEY, branch); } catch (e) {}
            return respond({ success: true, branch });
        },

        'admin_dashboard_data.php': async () => {
            const res = await rpc('rsm_admin_dashboard_data', { p_branch: adminBranch() });
            if (!res.ok) return res;
            return respond(addForecast(await res.json()));
        },
        'admin_branch_comparison.php': () => rpc('rsm_admin_branch_comparison', { p_branch: adminBranch() }),
        'admin_delivery_data.php': () => rpc('rsm_admin_delivery_data', { p_branch: adminBranch() }),
        'admin_update_order.php': async (o) => {
            const f = readBody(o.body);
            return rpc('rsm_admin_update_order', {
                p_order_id: Number(f.order_id) || 0, p_status: f.status || null, p_branch: adminBranch(),
            });
        },

        'admin_sales_data.php': async (o) => {
            if ((o.method || 'GET').toUpperCase() === 'GET') return rpc('rsm_admin_sales_list', { p_branch: adminBranch() });
            return rpc('rsm_admin_create_counter_sale', { p_payload: readBody(o.body), p_selected_branch: adminBranch() });
        },

        'admin_products.php': async (o) => {
            if ((o.method || 'GET').toUpperCase() === 'GET') return rpc('rsm_admin_products_list', { p_branch: adminBranch() });
            return rpc('rsm_admin_product_action', { p_input: readBody(o.body), p_branch: adminBranch() });
        },

        'admin_staff.php': async (o) => {
            if ((o.method || 'GET').toUpperCase() === 'GET') return rpc('rsm_admin_staff_list', { p_branch: adminBranch() });
            const f = readBody(o.body);
            if (f.action === 'toggle') {
                return rpc('rsm_admin_staff_toggle', { p_staff_id: Number(f.staff_id) || 0, p_branch: adminBranch() });
            }
            // create / delete need the service-role key, so they go through the edge function
            const { data, error } = await sb.functions.invoke('admin-staff', {
                body: { ...f, selected_branch: adminBranch() },
            });
            if (error || !data) return fail('Could not update staff accounts.', 500);
            return respond(data);
        },
    };

    window.rsmApi = async function (url, options) {
        const u = new URL(url, location.href);
        const name = u.pathname.split('/').pop();
        const handler = routes[name];
        if (!handler) throw new Error('Unknown endpoint: ' + name);
        try {
            return await handler(options || {}, u.searchParams);
        } catch (e) {
            console.error(name, e);
            return fail(SERVER_ERROR, 500);
        }
    };

    // ---------- auth helpers used by the login / register / reset / logout pages ----------
    window.rsmAuth = {
        async customerLogin(username, password) {
            const { data: email } = await sb.rpc('rsm_login_email', { p_username: username });
            const bad = { success: false, message: 'Incorrect username or password.' };
            if (!email) return bad;
            const { error } = await sb.auth.signInWithPassword({ email, password });
            if (error) return bad;
            return { success: true, message: 'Login successful! Redirecting...', redirect: 'customer_ordering.html' };
        },

        // Admin and staff share one page; the database decides which workspace they get.
        async adminLogin(email, password) {
            const bad = { success: false, message: 'Incorrect email or password.' };
            const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
            if (error) return bad;
            const { data: who } = await sb.rpc('rsm_whoami');
            if (!who) { await sb.auth.signOut(); return bad; }
            const redirect = who.type === 'admin' ? 'admin_dashboard.html'
                : who.role === 'sales' ? 'sales_staff.html' : 'delivery_staff.html';
            return { success: true, redirect };
        },

        async register(f) {
            const msg = await sb.rpc('rsm_check_registration', {
                p_username: f.username, p_email: f.email, p_branch: f.branch, p_phone: f.phone,
            });
            if (msg.error) return { success: false, message: 'Something went wrong. Please try again.' };
            if (msg.data) return { success: false, message: msg.data };
            if (f.password !== f.confirm_password) return { success: false, message: 'Passwords do not match.' };
            if (f.password.length < 8) return { success: false, message: 'Must be 8 characters long in password.' };
            const { error } = await sb.auth.signUp({
                email: f.email.trim(), password: f.password,
                options: { data: {
                    account_type: 'customer', username: f.username.trim(), address: f.address.trim(),
                    branch: f.branch.trim(), phone: f.phone.trim(),
                } },
            });
            if (error) return { success: false, message: 'Something went wrong. Please try again.' };
            await sb.auth.signOut(); // the login page expects a fresh sign-in
            return { success: true };
        },

        async requestPasswordReset(email, type) {
            const redirectTo = new URL('Forgot_password.html' + (type === 'admin' ? '?type=admin' : ''), location.href).href;
            await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo });
            return { success: true }; // never reveal whether the email exists
        },

        async setNewPassword(password) {
            const { error } = await sb.auth.updateUser({ password });
            if (error) return { success: false, message: error.message };
            await sb.auth.signOut();
            return { success: true };
        },

        async logout(redirect) {
            await sb.auth.signOut();
            location.href = redirect || 'Customer_Login.html?logged_out=1';
        },
    };

    // The old logout buttons were <form method="post" action="*_logout.php">.
    document.addEventListener('submit', (event) => {
        const action = event.target.getAttribute && event.target.getAttribute('action');
        const match = action && action.match(/(customer|admin|staff)_logout\.php/);
        if (!match) return;
        event.preventDefault();
        window.rsmAuth.logout(match[1] === 'customer' ? 'Customer_Login.html?logged_out=1' : 'Admin_login.html');
    });
})();
