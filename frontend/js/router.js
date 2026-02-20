/**
 * Client-side Router
 * Hash-based SPA routing for Cloudflare Pages.
 */

const Router = (() => {
    const pages = ['dashboard', 'workers', 'certificates', 'upload'];

    function init() {
        // Listen for hash changes
        window.addEventListener('hashchange', handleRoute);

        // Handle nav link clicks
        document.querySelectorAll('.nav-link[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                window.location.hash = `#${page}`;
            });
        });

        // Initial route
        handleRoute();
    }

    function handleRoute() {
        const hash = window.location.hash.slice(1) || 'dashboard';
        const page = pages.includes(hash) ? hash : 'dashboard';

        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });

        // Show active page
        document.querySelectorAll('.page').forEach(section => {
            section.classList.toggle('active', section.id === `page-${page}`);
        });

        // Close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');

        // Trigger page load callback
        if (typeof App !== 'undefined' && App.onPageChange) {
            App.onPageChange(page);
        }
    }

    function navigate(page) {
        window.location.hash = `#${page}`;
    }

    return { init, navigate };
})();
