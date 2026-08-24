import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ManagementLayout from '../../components/management/ManagementLayout';
import SearchableSelect from '../../components/common/SearchableSelect';
import { getUsers, createUser, updateUser, deleteUser, getOffices, getDivisions, updateUserStatus } from '../../services/api';
import { UserPlus, Shield, Mail, Building2, Layers, CheckCircle2, AlertCircle, Edit3, Trash2, ShieldCheck, ShieldOff, UserCheck, UserMinus } from 'lucide-react';


function UserManagement() {
  const [users, setUsers] = useState([]);
  const [offices, setOffices] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [selectedOffice, setSelectedOffice] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', suffix: '', email: '', role: 'Staff', officeId: '', divisionId: '' });
  const [editingUser, setEditingUser] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', action: null });
  const [error, setError] = useState('');

  // No longer needed: ProtectedRoute handles redirects
  useEffect(() => {
    getOffices().then(res => setOffices(res.data));
    getUsers().then(res => setUsers(res.data));
  }, []);

  useEffect(() => {
    if (selectedOffice) {
      getDivisions(selectedOffice).then(res => {
        setDivisions(res.data);
      });
    } else {
      setDivisions([]);
    }
  }, [selectedOffice]);

  const handleSaveUser = async (e) => {
    if (e) e.preventDefault();
    
    // Integrity check if division is selected
    if (!newUser.divisionId) {
      setError('Please select a division for the user.');
      return;
    }

    if (!showConfirmModal) {
      setConfirmConfig({
        title: editingUser ? 'Update User Account?' : 'Create User Account?',
        message: editingUser 
          ? `Are you sure you want to save changes to this account?` 
          : `Confirming creation of a new ${newUser.role} account.`,
        action: () => executeSave()
      });
      setShowConfirmModal(true);
      return;
    }
  };

  const executeSave = async () => {
    setError('');
    try {
      if (editingUser) {
        await updateUser(editingUser.id, newUser);
      } else {
        await createUser(newUser);
      }
      setIsModalOpen(false);
      setEditingUser(null);
      setShowConfirmModal(false);
      setNewUser({ firstName: '', lastName: '', suffix: '', email: '', role: 'Staff', officeId: '', divisionId: '' });
      setSelectedOffice('');
      // Refresh users
      const res = await getUsers();
      setUsers(res.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      setShowConfirmModal(false);
    }
  };

  const handleDeleteUser = (user) => {
    setConfirmConfig({
      title: 'Delete User?',
      message: `Are you sure you want to permanently remove ${user.firstName || user.name}? This user will lose all access to the portal.`,
      action: () => executeDelete(user.id)
    });
    setShowConfirmModal(true);
  };

  const executeDelete = async (id) => {
    try {
      await deleteUser(id);
      setUsers(users.filter(u => u.id !== id));
      setShowConfirmModal(false);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      setShowConfirmModal(false);
    }
  };

  const handleToggleStatus = (user) => {
    const action = user.isActive ? 'Deactivate' : 'Activate';
    setConfirmConfig({
      title: `${action} User Account?`,
      message: user.isActive 
        ? `Are you sure you want to deactivate access for ${user.firstName || user.lastName || user.name}? They will lose all access to the system until reactivated.`
        : `Are you sure you want to activate access for ${user.firstName || user.lastName || user.name}? They will immediately regain access to their assigned modules.`,
      action: () => executeToggleStatus(user)
    });
    setShowConfirmModal(true);
  };

  const executeToggleStatus = async (user) => {
    try {
      const newStatus = !user.isActive;
      await updateUserStatus(user.id, newStatus);
      setUsers(users.map(u => u.id === user.id ? { ...u, isActive: newStatus } : u));
      setShowConfirmModal(false);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      setShowConfirmModal(false);
    }
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setSelectedOffice(user.officeId);
    setNewUser({ 
      firstName: user.firstName || user.name?.split(' ')[0] || '', 
      lastName: user.lastName || user.name?.split(' ').slice(1).join(' ') || '', 
      suffix: user.suffix || '',
      email: user.email, 
      role: user.role, 
      officeId: user.officeId, 
      divisionId: user.divisionId 
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    setNewUser({ firstName: '', lastName: '', suffix: '', email: '', role: 'Staff', officeId: '', divisionId: '' });
    setSelectedOffice('');
    setError('');
  };

  return (
    <ManagementLayout title="User Management">
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-2xl font-black text-slate-800 tracking-tight">System Users</h3>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-moss-600 hover:bg-moss-700 text-white font-bold px-6 py-3 rounded-2xl flex items-center gap-2 transition-all shadow-lg shadow-moss-600/20 active:scale-95"
          >
            <UserPlus size={20} />
            Create New User
          </button>
        </div>

        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="px-6 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-widest">User Full Name</th>
                  <th className="px-6 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Office and Section</th>
                  <th className="px-6 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Role</th>
                  <th className="px-6 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Account Status</th>
                  <th className="px-6 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-slate-50/30 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 text-[13px] mb-0.5">
                          {user.firstName || user.lastName 
                            ? `${user.firstName || ''} ${user.lastName || ''} ${user.suffix ? user.suffix : ''}`.trim() 
                            : user.name}
                        </span>
                        <div className="text-slate-400 text-[10px] flex items-center gap-1 font-medium">
                          <Mail size={9} /> {user.email}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex flex-col">
                        <div className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5 mb-0.5 uppercase tracking-tight">
                          {user.office?.acronym || 'Unknown'}
                        </div>
                        <div className="text-[10px] font-medium text-slate-400 leading-tight">
                          {user.division?.name || 'Unassigned Section'}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border ${
                        user.role === 'Admin' 
                          ? 'bg-purple-50 text-purple-600 border-purple-100' 
                          : 'bg-blue-50 text-blue-600 border-blue-100'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <button 
                        onClick={() => handleToggleStatus(user)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[8px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                          user.isActive 
                            ? 'bg-green-50 text-green-600 border-green-100 hover:bg-green-100' 
                            : 'bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100'
                        }`}
                        title={user.isActive ? "Deactivate User" : "Activate User"}
                      >
                        {user.isActive ? (
                          <><ShieldCheck size={11} /> Active</>
                        ) : (
                          <><ShieldOff size={11} /> Inactive</>
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => openEditModal(user)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" 
                          title="Edit User"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button 
                          onClick={() => handleDeleteUser(user)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" 
                          title="Delete User"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeModal}></div>
            <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-[3rem] shadow-2xl p-8 md:p-12 animate-in zoom-in-95 duration-200">
              <h3 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">
                {editingUser ? 'Edit User Account' : 'Create User Account'}
              </h3>
              <p className="text-slate-400 mb-8 font-medium">
                {editingUser ? `Updating account details for ${editingUser.firstName} ${editingUser.lastName}.` : 'Assign a new user to their designated office and section. They will be assigned a default password.'}
              </p>
              
              {!editingUser && (
                <div className="mb-6 p-4 bg-blue-50 text-blue-700 rounded-2xl flex items-start gap-3 text-sm font-bold border border-blue-100 leading-snug">
                  <span className="flex-shrink-0 mt-0.5">ℹ️</span>
                  <p>New users are automatically assigned a secure random password.<br/><span className="font-medium text-blue-600">Their temporary credentials will be sent to their email address. They will be forced to change this password prior to accessing the dashboard.</span></p>
                </div>
              )}
              {error && (
                <div className="mb-8 p-4 bg-red-50 text-red-600 rounded-2xl flex items-center gap-3 text-sm font-bold border border-red-100">
                  <AlertCircle size={20} /> {error}
                </div>
              )}

              <form onSubmit={handleSaveUser} className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                <div className="md:col-span-1 border-b border-slate-100 pb-4 mb-2 md:border-none md:pb-0 md:mb-0">
                  <label className="block text-sm font-bold text-slate-700 mb-2">First Name</label>
                  <input 
                    type="text" required
                    value={newUser.firstName}
                    onChange={(e) => setNewUser({...newUser, firstName: e.target.value})}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                    placeholder="Juan"
                  />
                </div>
                <div className="md:col-span-1 border-b border-slate-100 pb-4 mb-2 md:border-none md:pb-0 md:mb-0">
                  <label className="block text-sm font-bold text-slate-700 mb-2">Last Name</label>
                  <input 
                    type="text" required
                    value={newUser.lastName}
                    onChange={(e) => setNewUser({...newUser, lastName: e.target.value})}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                    placeholder="Dela Cruz"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="block text-sm font-bold text-slate-700 mb-2">Suffix <span className="text-slate-400 font-normal">(Optional)</span></label>
                  <input 
                    type="text" 
                    value={newUser.suffix}
                    onChange={(e) => setNewUser({...newUser, suffix: e.target.value})}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                    placeholder="e.g. Jr., III"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="block text-sm font-bold text-slate-700 mb-2">Email Address</label>
                  <input 
                    type="email" required
                    value={newUser.email}
                    onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                    placeholder="j.doe@da.gov.ph"
                  />
                </div>
                <div className="md:col-span-1">
                  <SearchableSelect 
                    label="Office"
                    options={offices}
                    value={selectedOffice}
                    onChange={(val) => {
                      setSelectedOffice(val);
                      setNewUser({...newUser, officeId: val, divisionId: ''});
                    }}
                    placeholder="Select Office..."
                  />
                </div>
                <div className="md:col-span-1">
                  <SearchableSelect 
                    label="Division"
                    options={divisions}
                    value={newUser.divisionId}
                    onChange={(val) => setNewUser({...newUser, divisionId: val})}
                    placeholder={selectedOffice ? "Select Division..." : "Select Office First"}
                    className={!selectedOffice ? "opacity-50 pointer-events-none" : ""}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-2">System Role</label>
                  <div className="grid grid-cols-2 gap-4">
                    {['Admin', 'Staff'].map(role => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setNewUser({...newUser, role})}
                        className={`py-4 rounded-2xl font-bold transition-all border ${
                          newUser.role === role 
                            ? 'bg-moss-600 text-white border-moss-600 shadow-lg shadow-moss-600/20' 
                            : 'bg-white text-slate-400 border-slate-100 hover:border-moss-200 hover:text-slate-600'
                        }`}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2 flex gap-4 mt-4">
                  <button 
                    type="button"
                    onClick={closeModal}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-5 rounded-2xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-moss-600 hover:bg-moss-700 text-white font-bold py-5 rounded-2xl shadow-lg shadow-moss-600/20 transition-all"
                  >
                    {editingUser ? 'Update Account' : 'Create User Account'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setShowConfirmModal(false)}></div>
            <div className="relative w-full max-w-sm bg-white rounded-[2rem] shadow-2xl p-8 animate-in zoom-in-95 duration-200 text-center">
              <div className="w-16 h-16 bg-moss-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Shield className="text-moss-600 w-8 h-8" />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">{confirmConfig.title}</h3>
              <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                {confirmConfig.message}
              </p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3.5 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmConfig.action}
                  className="flex-1 bg-moss-600 hover:bg-moss-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-moss-600/20 transition-all active:scale-95"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ManagementLayout>
  );
}

export default UserManagement;
