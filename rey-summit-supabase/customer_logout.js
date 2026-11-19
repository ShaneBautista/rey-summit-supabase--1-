document.addEventListener('DOMContentLoaded', () => {
    const logoutModal = document.getElementById('logoutModal');
    const cancelLogout = document.getElementById('cancelLogout');

    if (!logoutModal) return;

    const closeLogoutModal = () => logoutModal.classList.remove('open');
    const openLogoutModal = () => logoutModal.classList.add('open');

    document.querySelectorAll('[data-logout-trigger], #logoutTrigger').forEach((trigger) => {
        trigger.addEventListener('click', openLogoutModal);
    });

    cancelLogout?.addEventListener('click', closeLogoutModal);
    logoutModal.addEventListener('click', (event) => {
        if (event.target === logoutModal) closeLogoutModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && logoutModal.classList.contains('open')) closeLogoutModal();
    });
});
