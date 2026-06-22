'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import netlifyLogo from 'public/netlify-logo.svg';
import githubLogo from 'public/images/github-mark-white.svg';

const navItems = [
    { linkText: 'Home', href: '/' },
    { linkText: 'Revalidation', href: '/revalidation' },
    { linkText: 'Image CDN', href: '/image-cdn' },
    { linkText: 'Edge Function', href: '/edge' },
    { linkText: 'Blobs', href: '/blobs' },
    { linkText: 'Classics', href: '/classics' },
    { linkText: 'Middleware', href: '/middleware' },
    { linkText: 'Routing', href: '/routing' }
];

export function Header() {
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <nav className="pt-6 pb-12 sm:pt-12 md:pb-24">
            <div className="flex items-center gap-4">
                <Link href="/" className="shrink-0">
                    <Image src={netlifyLogo} alt="Netlify logo" />
                </Link>

                {/* Desktop navigation */}
                <ul className="hidden sm:flex flex-wrap gap-x-4 gap-y-1">
                    {navItems.map((item, index) => (
                        <li key={index}>
                            <Link href={item.href} className="inline-flex px-3 py-2">
                                {item.linkText}
                            </Link>
                        </li>
                    ))}
                </ul>

                <div className="flex items-center gap-2 ml-auto">
                    <Link
                        href="https://github.com/netlify-templates/next-platform-starter"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Image src={githubLogo} alt="GitHub logo" className="w-7" />
                    </Link>

                    {/* Hamburger button — mobile only */}
                    <button
                        className="sm:hidden flex flex-col justify-center gap-1.5 w-11 h-11 p-2.5 -mr-1.5"
                        onClick={() => setMenuOpen((prev) => !prev)}
                        aria-label={menuOpen ? 'Chiudi menu' : 'Apri menu'}
                        aria-expanded={menuOpen}
                        aria-controls="mobile-menu"
                    >
                        <span
                            className={`block w-full h-0.5 bg-white transition-all duration-300 origin-center ${
                                menuOpen ? 'rotate-45 translate-y-2' : ''
                            }`}
                        />
                        <span
                            className={`block w-full h-0.5 bg-white transition-all duration-300 ${
                                menuOpen ? 'opacity-0 scale-x-0' : ''
                            }`}
                        />
                        <span
                            className={`block w-full h-0.5 bg-white transition-all duration-300 origin-center ${
                                menuOpen ? '-rotate-45 -translate-y-2' : ''
                            }`}
                        />
                    </button>
                </div>
            </div>

            {/* Mobile navigation */}
            {menuOpen && (
                <ul id="mobile-menu" className="sm:hidden flex flex-col mt-3 pt-3 border-t border-white/20 gap-0.5">
                    {navItems.map((item, index) => (
                        <li key={index}>
                            <Link
                                href={item.href}
                                className="flex items-center min-h-11 px-3 py-2.5 rounded-md no-underline hover:bg-white/10 active:bg-white/20 transition-colors"
                                onClick={() => setMenuOpen(false)}
                            >
                                {item.linkText}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </nav>
    );
}
