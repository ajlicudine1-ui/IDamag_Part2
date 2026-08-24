import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';

import { login } from '../../services/api';
import logo from '../../assets/dalogo.png';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  // Auto-dismiss error after 3 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError('');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleInputChange = (setter) => (e) => {
    setter(e.target.value);
    if (error) setError('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      const res = await login({ email, password });
      // Store user info in localStorage for "session"
      localStorage.setItem('user', JSON.stringify(res.data));
      navigate('/reports');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-slate-100 p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center transition-transform hover:scale-105 duration-300">
            <img src={logo} alt="DA Logo" className="w-full h-full object-contain drop-shadow-md" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Ilocos DAmag</h1>
          <p className="text-sm font-bold text-slate-500 mt-1.5 uppercase tracking-widest">Staff Portal</p>
        </div>

        {error && (
          <div className="mb-5 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-[11px] font-bold border border-red-100 animate-in fade-in slide-in-from-top-2 duration-300 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Email Address</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={handleInputChange(setEmail)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
              placeholder="name@da.gov.ph"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Password</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} 
                required
                value={password}
                onChange={handleInputChange(setPassword)}
                className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                placeholder="••••••••"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button 
            type="submit"
            disabled={isLoading}
            className={`w-full bg-moss-600 hover:bg-moss-700 text-white text-sm font-bold py-3.5 rounded-xl mt-2 shadow-lg shadow-moss-600/20 transition-all transform active:scale-[0.98] ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
        
        <div className="mt-6 pt-6 border-t border-slate-100 text-center space-y-3">
          <p className="text-xs text-slate-500 font-medium">
            Don't have an account? <Link to="/register" className="text-moss-600 font-bold hover:underline">Register</Link>
          </p>
          <div className="block">
            <Link to="/" className="text-slate-400 hover:text-moss-600 text-[11px] font-bold transition-colors">
              ← Back to Public Site
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
