import React from 'react';

const Footer = () => {
  const year = new Date().getFullYear();
  return (
    <footer className="py-8 border-t border-slate-200 mt-8 text-center bg-white/50">
      <div className="max-w-6xl mx-auto px-4 text-slate-400 text-xs tracking-wide">
        <p>&copy; {year} Information Management Section {"(IMS)"}</p>
      </div>
    </footer>
  );
};

export default Footer;
