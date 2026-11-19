// ============================================
// login.js
// 1) Show/hide password button
// 2) Submit the login form with fetch(), show result in #loginMessage
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    if (!paramsLoggedOut()) {
        rsmSupabase.auth.getSession().then(async ({ data, error }) => {
            if (error || !data.session) return;

            if (document.querySelector('form')?.id === 'adminLoginForm') {
                const { data: who } = await rsmSupabase.rpc('rsm_whoami');
                if (who?.type === 'admin') {
                    window.location.replace('admin_dashboard.html');
                } else if (who?.type === 'staff') {
                    window.location.replace(who.role === 'sales' ? 'sales_staff.html' : 'delivery_staff.html');
                }
                return;
            }

            const { data: who } = await rsmSupabase.rpc('rsm_whoami');
            if (who?.type === 'admin') {
                window.location.replace('admin_dashboard.html');
            } else if (who?.type === 'staff') {
                window.location.replace(who.role === 'sales' ? 'sales_staff.html' : 'delivery_staff.html');
            } else {
                window.location.replace('customer_ordering.html');
            }
        });
    }

    const form         = document.querySelector('form');
    const messageBox   = document.getElementById('loginMessage');
    const passwordInput = document.getElementById('password');
    const toggleBtn     = document.querySelector('.password-toggle');

    // ---- Password show/hide ----
    if (toggleBtn && passwordInput) {
        toggleBtn.addEventListener('click', () => {
            const isVisible = passwordInput.type === 'text';
            passwordInput.type = isVisible ? 'password' : 'text';
            toggleBtn.classList.toggle('is-visible', !isVisible);
            toggleBtn.setAttribute('aria-pressed', String(!isVisible));
            toggleBtn.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
        });
    }

    // ---- Messages carried in the URL (after registering, resetting a password, logging out) ----
    const params = new URLSearchParams(window.location.search);
    const errorMessage = params.get('error');

    if (params.get('registered') === '1' && messageBox) {
        showMessage('Account created! You can log in now.', 'success');
    } else if (params.get('reset') === 'success' && messageBox) {
        showMessage('Password updated. You can log in now.', 'success');
    } else if (errorMessage && messageBox) {
        showMessage(errorMessage, 'error');
    }

    // ---- Supabase login (customer: username + password, admin/staff: email + password) ----
    if (form) {
        const isAdminForm = form.id === 'adminLoginForm';

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            showMessage('', 'error'); // clear old message

            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;

            try {
                const password = passwordInput.value;
                const data = isAdminForm
                    ? await rsmAuth.adminLogin(form.elements.adminEmail.value, password)
                    : await rsmAuth.customerLogin(form.elements.username.value.trim(), password);

                if (data.success) {
                    showMessage(data.message || 'Login successful! Redirecting...', 'success');
                    setTimeout(() => { window.location.href = data.redirect; }, 400);
                } else {
                    showMessage(data.message || 'Login failed.', 'error');
                }
            } catch (err) {
                showMessage('Could not reach the server. Please try again.', 'error');
            } finally {
                submitBtn.disabled = false;
            }
        });
    }

    function showMessage(text, type) {
        if (!messageBox) return;
        messageBox.textContent = text;
        messageBox.className = `message ${type}`;
    }
});

function paramsLoggedOut() {
    return new URLSearchParams(window.location.search).get('logged_out') === '1';
}