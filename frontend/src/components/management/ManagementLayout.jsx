import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown, KeyRound, Eye, EyeOff } from 'lucide-react';
import ManagementSidebar from './ManagementSidebar';
import { changePassword, logLogout } from '../../services/api';

function ManagementLayout({ children, title }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isForcePasswordChange, setIsForcePasswordChange] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [passwordState, setPasswordState] = useState({ error: '', success: '', loading: false });
  const [showPwd, setShowPwd] = useState({ current: false, new: false, confirm: false });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      if (parsedUser.requiresPasswordChange) {
        setIsForcePasswordChange(true);
      }
    }
    
    // Click outside to close dropdown
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      if (user) {
        await logLogout({ userId: user.id, email: user.email });
      }
    } catch (err) {
      console.error('Failed to log logout:', err);
    } finally {
      localStorage.removeItem('user');
      navigate('/login');
    }
  };

  const getInitials = (userObj) => {
    if (!userObj) return '??';
    if (userObj.firstName && userObj.lastName) {
      return `${userObj.firstName[0]}${userObj.lastName[0]}`.toUpperCase();
    }
    if (userObj.firstName) return userObj.firstName.substring(0, 2).toUpperCase();
    if (userObj.name) return userObj.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    return '??';
  };

  const getFullName = (userObj) => {
    if (!userObj) return '';
    if (userObj.firstName || userObj.lastName) {
      return `${userObj.firstName || ''} ${userObj.lastName || ''} ${userObj.suffix || ''}`.trim();
    }
    return userObj.name || '';
  };

  const validatePassword = (password) => {
    const minLength = 8;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (password.length < minLength) return "Password must be at least 8 characters long.";
    if (!hasUpper) return "Password must contain at least one uppercase letter (A-Z).";
    if (!hasLower) return "Password must contain at least one lowercase letter (a-z).";
    if (!hasNumber) return "Password must contain at least one number (0-9).";
    if (!hasSpecial) return "Password must contain at least one special character.";
    return null;
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordState({ error: '', success: '', loading: true });

    if (passwordForm.new !== passwordForm.confirm) {
      setPasswordState({ error: "New passwords do not match.", success: '', loading: false });
      return;
    }

    const passwordError = validatePassword(passwordForm.new);
    if (passwordError) {
      setPasswordState({ error: passwordError, success: '', loading: false });
      return;
    }

    try {
      await changePassword(user.id, { 
        currentPassword: passwordForm.current, 
        newPassword: passwordForm.new 
      });
      setPasswordState({ error: '', success: 'Password changed successfully!', loading: false });
      
      const updatedUser = { ...user, requiresPasswordChange: false };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setUser(updatedUser);

      setTimeout(() => {
        setIsPasswordModalOpen(false);
        setIsForcePasswordChange(false);
        setPasswordForm({ current: '', new: '', confirm: '' });
        setPasswordState({ error: '', success: '', loading: false });
      }, 2000);
    } catch (err) {
      setPasswordState({ 
        error: err.response?.data?.message || 'Failed to change password.', 
        success: '', 
        loading: false 
      });
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50/50 text-slate-900 selection:bg-moss-200">
      <ManagementSidebar isCollapsed={isSidebarCollapsed} setIsCollapsed={setIsSidebarCollapsed} />
      <div className="flex-grow flex flex-col min-w-0">
        <header className="h-20 bg-white border-b border-slate-100 flex items-center justify-end px-10 flex-shrink-0 z-40">
          <div className="relative" ref={dropdownRef}>
            <button 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-4 hover:bg-slate-50 p-2 rounded-2xl transition-all duration-300 group outline-none"
            >
              <div className="hidden sm:block text-right">
                <p className="text-sm font-black text-slate-800 leading-none mb-1 group-hover:text-moss-600 transition-colors">
                  {user ? getFullName(user) : 'Loading...'}
                </p>
                <div className="flex items-center justify-end font-bold uppercase tracking-widest text-[9px] text-slate-400 group-hover:text-moss-500">
                  {user?.role === 'Admin' ? 'Admin' : (user?.office?.acronym || 'DA - RFO I')}
                </div>
              </div>
              <div className="relative">
                <div className="w-10 h-10 bg-moss-600 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-moss-600/20 group-hover:scale-110 transition-transform duration-300">
                  {getInitials(user)}
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-white border-2 border-slate-50 rounded-full flex items-center justify-center shadow-sm">
                  <ChevronDown size={10} className={`text-slate-500 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </button>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div className="absolute right-0 mt-3 w-56 bg-white rounded-[2rem] border border-slate-100 shadow-[0_20px_40px_-15px_rgba(47,55,70,0.15)] p-2 animate-in fade-in slide-in-from-top-4 duration-200">
                <div className="px-4 py-3 mb-2 border-b border-slate-50 md:hidden">
                    <p className="text-sm font-black text-slate-800 truncate">{user ? getFullName(user) : ''}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">{user?.role === 'Admin' ? 'Admin' : user?.office?.acronym}</p>
                </div>
                <div className="space-y-1">
                    <button 
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setIsPasswordModalOpen(true);
                          setPasswordForm({ current: '', new: '', confirm: '' });
                          setPasswordState({ error: '', success: '', loading: false });
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-slate-600 hover:bg-moss-50 hover:text-moss-600 transition-colors text-left"
                    >
                        <KeyRound size={18} />
                        Change Password
                    </button>
                    <div className="h-px bg-slate-100 my-1 mx-2"></div>
                    <button 
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setIsLogoutModalOpen(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors text-left"
                    >
                        <LogOut size={18} />
                        Sign Out
                    </button>
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-grow overflow-y-auto p-6 bg-[radial-gradient(circle_at_top_right,transparent,transparent,rgba(74,93,35,0.02))]">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>

      {isLogoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsLogoutModalOpen(false)}></div>
          <div className="relative w-full max-w-sm bg-white rounded-[2rem] shadow-2xl p-8 animate-in zoom-in-95 duration-200 text-center">
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <LogOut className="text-red-500 w-8 h-8" />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">Sign Out</h3>
            <p className="text-slate-500 text-sm mb-8 leading-relaxed">
              Are you sure you want to sign out of your account?
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setIsLogoutModalOpen(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3.5 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={handleLogout}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-red-500/20 transition-all active:scale-95"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal (Forced or Voluntary) */}
      {(isPasswordModalOpen || isForcePasswordChange) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className={`absolute inset-0 bg-slate-900/${isForcePasswordChange ? '80' : '40'} backdrop-blur-sm`} onClick={() => !isForcePasswordChange && !passwordState.loading && setIsPasswordModalOpen(false)}></div>
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900 mb-2 flex items-center gap-2">
              <KeyRound className="text-moss-600" /> {isForcePasswordChange ? 'Secure Your Account' : 'Change Password'}
            </h3>
            
            {isForcePasswordChange ? (
              <p className="text-sm text-slate-500 mb-6 font-medium">
                Welcome! For security purposes, you must change your temporary default password before accessing the dashboard.
              </p>
            ) : <div className="mb-6"></div>}
            
            {passwordState.error && (
              <div className="mb-4 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold border border-red-100">
                {passwordState.error}
              </div>
            )}
            {passwordState.success && (
              <div className="mb-4 px-4 py-2 bg-moss-50 text-moss-600 rounded-xl text-xs font-bold border border-moss-100">
                {passwordState.success}
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              {/* Current Password */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Current Password</label>
                <div className="relative">
                  <input 
                    type={showPwd.current ? "text" : "password"} 
                    required
                    value={passwordForm.current}
                    onChange={(e) => setPasswordForm({...passwordForm, current: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 outline-none pr-10"
                  />
                  <button type="button" onClick={() => setShowPwd({...showPwd, current: !showPwd.current})} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 p-1">
                    {showPwd.current ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              
              {/* New Password */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">New Password</label>
                <div className="relative">
                  <input 
                    type={showPwd.new ? "text" : "password"} 
                    required
                    value={passwordForm.new}
                    onChange={(e) => setPasswordForm({...passwordForm, new: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 outline-none pr-10"
                  />
                  <button type="button" onClick={() => setShowPwd({...showPwd, new: !showPwd.new})} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 p-1">
                    {showPwd.new ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-[9px] text-slate-400 mt-1">Must be 8+ chars with upper, lower, number & special char.</p>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <input 
                    type={showPwd.confirm ? "text" : "password"} 
                    required
                    value={passwordForm.confirm}
                    onChange={(e) => setPasswordForm({...passwordForm, confirm: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 outline-none pr-10"
                  />
                  <button type="button" onClick={() => setShowPwd({...showPwd, confirm: !showPwd.confirm})} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 p-1">
                    {showPwd.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                {!isForcePasswordChange && (
                  <button 
                    type="button"
                    onClick={() => setIsPasswordModalOpen(false)}
                    disabled={passwordState.loading}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3.5 rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                )}
                <button 
                  type="submit"
                  disabled={passwordState.loading}
                  className="flex-1 bg-moss-600 hover:bg-moss-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-moss-600/20 transition-all disabled:opacity-50"
                >
                  {passwordState.loading ? 'Updating...' : 'Save Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ManagementLayout;
