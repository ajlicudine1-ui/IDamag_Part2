import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { createUser, getOffices, getDivisions } from '../../services/api';
import logo from '../../assets/dalogo.png';
import SearchableSelect from '../../components/common/SearchableSelect';

function Register() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    suffix: '',
    email: '',
    password: '',
    confirmPassword: '',
    officeId: '',
    divisionId: ''
  });
  const [offices, setOffices] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  // Load Offices on mount
  useEffect(() => {
    getOffices().then(res => setOffices(res.data)).catch(err => console.error("Could not load offices", err));
  }, []);

  // Load Divisions when an Office is selected
  useEffect(() => {
    if (formData.officeId) {
      getDivisions(formData.officeId).then(res => setDivisions(res.data)).catch(err => console.error("Could not load divisions", err));
    } else {
      setDivisions([]);
      setFormData(prev => ({ ...prev, divisionId: '' }));
    }
  }, [formData.officeId]);

  // Auto-dismiss messages
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError('');
        if (success) navigate('/login');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error, success, navigate]);

  const handleInputChange = (field) => (e) => {
    setFormData({ ...formData, [field]: e.target.value });
    if (error) setError('');
  };

  const handleSelectChange = (field) => (val) => {
    setFormData({ ...formData, [field]: val });
    if (error) setError('');
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

  const handleRegister = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    // Basic validation
    if (!formData.officeId || !formData.divisionId) {
      setError("Please select both an Office and a Division.");
      setIsLoading(false);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match.");
      setIsLoading(false);
      return;
    }

    const passwordError = validatePassword(formData.password);
    if (passwordError) {
      setError(passwordError);
      setIsLoading(false);
      return;
    }

    // Omit confirmPassword from the data sent to the backend
    const { confirmPassword, ...submitData } = formData;

    try {
      // Force role to Staff for public registration
      await createUser({ ...submitData, role: 'Staff' });
      setSuccess('Registration successful! Your account is now pending administrative approval.');
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Registration failed. Please make sure email is unique.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6 py-12">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 p-8 md:p-10">
        <div className="text-center mb-10">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center transition-transform hover:scale-105 duration-300">
            <img src={logo} alt="DA Logo" className="w-full h-full object-contain drop-shadow-md" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Create Account</h1>
          <p className="text-sm font-bold text-slate-500 mt-1.5 uppercase tracking-widest">Ilocos DAmag</p>
        </div>

        {error && (
          <div className="mb-5 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-[11px] font-bold border border-red-100 animate-in fade-in slide-in-from-top-2 duration-300 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="leading-tight">{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-5 px-4 py-2 bg-moss-50 text-moss-600 rounded-xl text-[11px] font-bold border border-moss-100 animate-in fade-in slide-in-from-top-2 duration-300 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
            <span className="leading-tight">{success}</span>
          </div>
        )}

        <form onSubmit={handleRegister} className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-5">
          {/* Row 1: Name */}
          <div className="md:col-span-5">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 pl-1">First Name</label>
            <input 
              type="text" 
              required
              value={formData.firstName}
              onChange={handleInputChange('firstName')}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
              placeholder="Juan"
            />
          </div>
          <div className="md:col-span-5">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 pl-1">Last Name</label>
            <input 
              type="text" 
              required
              value={formData.lastName}
              onChange={handleInputChange('lastName')}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
              placeholder="Dela Cruz"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 pl-1" title="Optional">Suffix</label>
            <input 
              type="text" 
              value={formData.suffix}
              onChange={handleInputChange('suffix')}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
              placeholder="Jr."
            />
          </div>

          {/* Row 2: Email */}
          <div className="md:col-span-12">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 pl-1">Email Address</label>
            <input 
              type="email" 
              required
              value={formData.email}
              onChange={handleInputChange('email')}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
              placeholder="juan.delacruz@da.gov.ph"
            />
          </div>

          {/* Row 3: Organization */}
          <div className="md:col-span-6">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 pl-1">Categories</label>
            <SearchableSelect 
               options={offices}
               value={formData.officeId}
               onChange={handleSelectChange('officeId')}
               placeholder="Select your Category..."
            />
          </div>
          <div className="md:col-span-6">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 pl-1">Subcategories</label>
             <SearchableSelect 
               options={divisions}
               value={formData.divisionId}
               onChange={handleSelectChange('divisionId')}
               placeholder={formData.officeId ? "Select your Subcategory..." : "Select Category First"}
             />
          </div>

          {/* Row 4: Password */}
          <div className="md:col-span-6">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 pl-1">Password</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} 
                required
                value={formData.password}
                onChange={handleInputChange('password')}
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
            <p className="text-[10px] text-slate-400 mt-1.5 pl-1 font-medium leading-tight">8+ chars, uppercase, lowercase, number & special char.</p>
          </div>
          <div className="md:col-span-6">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 pl-1">Confirm Password</label>
            <div className="relative">
              <input 
                type={showConfirmPassword ? "text" : "password"} 
                required
                value={formData.confirmPassword}
                onChange={handleInputChange('confirmPassword')}
                className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                placeholder="••••••••"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                tabIndex="-1"
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <div className="md:col-span-12 mt-4 pt-4 border-t border-slate-100">
            <button 
              type="submit"
              disabled={isLoading || success}
              className={`w-full bg-moss-600 hover:bg-moss-700 text-white text-sm font-bold py-4 rounded-xl shadow-lg shadow-moss-600/20 transition-all transform active:scale-[0.99] ${isLoading || success ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isLoading ? 'Registering...' : success ? 'Success! Redirecting...' : 'Complete Registration'}
            </button>
          </div>
        </form>
        
        <div className="mt-8 pt-6 border-t border-slate-100 text-center space-y-3">
          <p className="text-xs text-slate-500 font-medium">
            Already have an account? <Link to="/login" className="text-moss-600 font-bold hover:underline">Sign In</Link>
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


export default Register;
