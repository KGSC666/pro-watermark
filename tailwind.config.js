/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/**/*.{ts,tsx}', './index.html'],
    theme: {
        extend: {
            colors: {
                neutral: {
                    950: '#050505',
                },
            },
            backdropBlur: {
                '3xl': '64px',
            },
        },
    },
    plugins: [],
};
