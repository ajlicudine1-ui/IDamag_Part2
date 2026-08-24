import React from 'react';
import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';
import dalogo from '../../assets/dalogo.png';

const NotFound = () => {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full animate-in fade-in zoom-in duration-700">
        {/* Logo or Branded Element */}
        <div className="mb-12 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-moss-600/20 blur-3xl rounded-full"></div>
            <img src={dalogo} alt="DA Logo" className="relative h-24 w-auto drop-shadow-2xl" />
          </div>
        </div>

        {/* Error Code */}
        <h1 className="text-9xl font-black text-slate-200 mb-2 leading-none">404</h1>
        
        {/* Message */}
        <div className="space-y-4 mb-10">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Page Not Found</h2>
          <p className="text-slate-500 leading-relaxed">
            The link you followed may be broken, or the page may have been removed. 
            Don't worry, it happens to the best of us.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link 
            to="/" 
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-moss-600 hover:bg-moss-700 text-white font-bold px-8 py-4 rounded-2xl transition-all shadow-xl shadow-moss-600/20 active:scale-95 group"
          >
            <Home size={20} className="group-hover:-translate-y-0.5 transition-transform" />
            Back to Home
          </Link>
        </div>
      </div>

      {/* Footer Branding */}
      <p className="fixed bottom-8 text-xs font-bold text-slate-300 uppercase tracking-[0.3em]">
        {new Date().getFullYear()} Information Management Section {"(IMS)"}
      </p>
    </div>
  );
};

export default NotFound;
