/**
 * Client-side Router
 * Hash-based SPA routing for Cloudflare Pages.
 */

const Router = (() => {
    const pages = ['dashboard', 'workers', 'worker-profile', 'upload', 'certifications'];

    function init() {
        window.addEventListener('hashchange', onRouteChange);
        // Initial route
        onRouteChange();
    }

    function onRouteChange() {
        const hash = window.location.hash.replace('#', '') || 'dashboard';
        const [page, ...params] = hash.split('/');
        activatePage(page, params);
    }

    function activatePage(page, params = []) {
        // Normalize
        const targetPage = pages.includes(page) ? page : 'dashboard';

        // Hide all pages
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

        // Show target page
        const el = document.getElementById(`page-${targetPage}`);
        if (el) el.classList.add('active');

        // Update nav
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === targetPage);
        });

        // Close mobile sidebar
        document.getElementById('sidebar')?.classList.remove('open');

        // Trigger page-specific load
        if (typeof App !== 'undefined' && App.onPageChange) {
            App.onPageChange(targetPage, params);
        }
    }

    function navigate(page, ...params) {
        const hash = params.length > 0 ? `${page}/${params.join('/')}` : page;
        window.location.hash = hash;
    }

    return { init, navigate, activatePage };
})();
