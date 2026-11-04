document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('accountForm');
    const message = document.getElementById('accountMessage');
    const saveButton = document.getElementById('accountSave');

    loadAccount();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        message.textContent = '';
        message.className = 'account-message';
        saveButton.disabled = true;

        try {
            const response = await rsmApi('customer_account.php', {
                method: 'POST',
                body: new FormData(form),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Could not save your account details.');
            }
            message.textContent = 'Account details saved.';
            message.className = 'account-message success';
        } catch (error) {
            message.textContent = error.message || 'Could not reach the server. Please try again.';
            message.className = 'account-message error';
        } finally {
            saveButton.disabled = false;
        }
    });

    async function loadAccount() {
        try {
            const response = await rsmApi('customer_account.php');
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(response.status === 401
                    ? 'Please log in to view your account details.'
                    : (data.message || 'Could not load your account details.'));
            }
            form.elements.username.value = data.account.username;
            form.elements.email.value = data.account.email || '';
            document.getElementById('accountBranch').value = data.account.branch || '';
            form.elements.address.value = data.account.address;
            form.elements.phone.value = data.account.phone;
        } catch (error) {
            message.textContent = error.message || 'Could not reach the server. Please try again.';
            message.className = 'account-message error';
        }
    }
});
