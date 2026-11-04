document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.querySelector('form');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const phoneInput = document.getElementById('phone');
    const message = document.getElementById('registerMessage');

    if (!registerForm || !passwordInput || !confirmPasswordInput || !phoneInput) {
        return;
    }

    const registrationError = new URLSearchParams(window.location.search).get('error');
    if (registrationError && message) {
        message.textContent = registrationError;
    }

    const validateForm = () => {
        const passwordTooShort = passwordInput.value.length < 8;
        const passwordsDoNotMatch = passwordInput.value !== confirmPasswordInput.value;

        passwordInput.setCustomValidity(
            passwordTooShort ? 'Must be 8 characters long in password.' : ''
        );
        confirmPasswordInput.setCustomValidity(
            passwordsDoNotMatch ? 'Passwords do not match.' : ''
        );
    };

    passwordInput.addEventListener('input', validateForm);
    confirmPasswordInput.addEventListener('input', validateForm);
    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        validateForm();

        if (passwordInput.value.length < 8) {
            passwordInput.reportValidity();
            return;
        }

        const button = registerForm.querySelector('button[type="submit"]');
        button.disabled = true;
        message.textContent = '';
        try {
            const result = await rsmAuth.register(Object.fromEntries(new FormData(registerForm).entries()));
            if (result.success) {
                window.location.href = 'Customer_Login.html?registered=1';
                return;
            }
            message.textContent = result.message;
        } catch (error) {
            message.textContent = 'Something went wrong. Please try again.';
        }
        button.disabled = false;
    });

    phoneInput.addEventListener('input', () => {
        phoneInput.value = phoneInput.value.replace(/\D/g, '');
    });
});
