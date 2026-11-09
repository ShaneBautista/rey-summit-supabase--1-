document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('accountForm');
    const message = document.getElementById('accountMessage');
    const saveButton = document.getElementById('accountSave');
    const supportForm = document.getElementById('supportTicketForm');
    const supportMessage = document.getElementById('supportTicketMessage');
    const supportList = document.getElementById('supportTicketList');
    const supportSubmitButton = document.getElementById('supportTicketSubmit');

    loadAccount();
    loadSupportTickets();

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

    supportForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        supportMessage.textContent = '';
        supportMessage.className = 'account-message';
        supportSubmitButton.disabled = true;

        try {
            const payload = new FormData(supportForm);
            const response = await rsmApi('customer_support_ticket.php', {
                method: 'POST',
                body: payload,
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Could not submit your support ticket.');
            }
            supportMessage.textContent = data.message || 'Support ticket submitted successfully.';
            supportMessage.className = 'account-message success';
            supportForm.reset();
            document.getElementById('supportPriority').value = 'medium';
            await loadSupportTickets();
        } catch (error) {
            supportMessage.textContent = error.message || 'Could not reach the server. Please try again.';
            supportMessage.className = 'account-message error';
        } finally {
            supportSubmitButton.disabled = false;
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

    async function loadSupportTickets() {
        try {
            const response = await rsmApi('customer_support_ticket.php');
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Could not load your support tickets.');
            }

            if (!Array.isArray(data.tickets) || data.tickets.length === 0) {
                supportList.innerHTML = '<p class="support-empty">You have not submitted any tickets yet.</p>';
                return;
            }

            supportList.innerHTML = data.tickets.map(ticket => {
                const createdAt = new Date(ticket.created_at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                });
                const status = String(ticket.status || 'open').replace(/\s+/g, '_');
                const priority = String(ticket.priority || 'medium');
                return `
                    <article class="support-ticket-item">
                        <div class="support-ticket-top">
                            <div class="support-ticket-title">${escapeHtml(ticket.subject || 'Untitled ticket')}</div>
                            <span class="support-ticket-badge status-${status}">${formatStatus(ticket.status || 'open')}</span>
                        </div>
                        <div class="support-ticket-meta">
                            <span>#${ticket.ticket_id}</span>
                            <span>${escapeHtml(ticket.category || 'Other')}</span>
                            <span class="support-ticket-badge priority-${priority}">${formatPriority(ticket.priority || 'medium')}</span>
                            <span>${createdAt}</span>
                        </div>
                        <div class="support-ticket-body">${escapeHtml(ticket.message || '')}</div>
                    </article>
                `;
            }).join('');
        } catch (error) {
            supportList.innerHTML = `<p class="support-empty">${escapeHtml(error.message || 'Support tickets are unavailable right now.')}</p>`;
        }
    }

    function formatStatus(value) {
        return value
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function formatPriority(value) {
        return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Medium';
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[character]));
    }
});
