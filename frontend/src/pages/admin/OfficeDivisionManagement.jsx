import React, { useState, useEffect } from 'react';
import ManagementLayout from '../../components/management/ManagementLayout';
import SearchableSelect from '../../components/common/SearchableSelect';
import { getOffices, createOffice, updateOffice, deleteOffice, getDivisions, createDivision, updateDivision, deleteDivision } from '../../services/api';
import { Plus, Building2, Layout, Edit3, Trash2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';

function OfficeDivisionManagement() {
  const [offices, setOffices] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('offices'); // 'offices' or 'sections'
  
  // Modals state
  const [isOfficeModalOpen, setIsOfficeModalOpen] = useState(false);
  const [isSectionModalOpen, setIsSectionModalOpen] = useState(false);
  const [editingOffice, setEditingOffice] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  
  // Forms state
  const [officeForm, setOfficeForm] = useState({ name: '', acronym: '' });
  const [sectionForm, setSectionForm] = useState({ name: '', acronym: '', officeId: '' });
  
  // UI state
  const [expandedOffices, setExpandedOffices] = useState({});
  const [officePage, setOfficePage] = useState(1);
  const [sectionPage, setSectionPage] = useState(1);
  const itemsPerPage = 10;
  
  // Confirmation Modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', action: null });
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [offRes, secRes] = await Promise.all([getOffices(), getDivisions()]);
      setOffices(offRes.data);
      setDivisions(secRes.data);
      
      // Auto-expand offices that have sections
      const initialExpanded = {};
      offRes.data.forEach(off => {
        initialExpanded[off.id] = true;
      });
      setExpandedOffices(initialExpanded);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (officeId) => {
    setExpandedOffices(prev => ({ ...prev, [officeId]: !prev[officeId] }));
  };

  // Office Handlers
  const handleSaveOffice = async (e) => {
    e.preventDefault();
    setValidationError('');

    // Duplicate Check
    const nameExists = offices.some(off => 
      off.name.toLowerCase().trim() === officeForm.name.toLowerCase().trim() && 
      off.id !== editingOffice?.id
    );

    if (nameExists) {
      setValidationError('An office with this name already exists.');
      return;
    }

    setConfirmConfig({
      title: editingOffice ? 'Update Office?' : 'Add New Office?',
      message: editingOffice 
        ? `Are you sure you want to save changes to ${editingOffice.name}?`
        : `Are you sure you want to add "${officeForm.name}" to the system?`,
      type: 'save',
      action: () => executeSaveOffice()
    });
    setShowConfirmModal(true);
  };

  const executeSaveOffice = async () => {
    try {
      if (editingOffice) {
        await updateOffice(editingOffice.id, officeForm);
      } else {
        await createOffice(officeForm);
      }
      setIsOfficeModalOpen(false);
      setEditingOffice(null);
      setOfficeForm({ name: '', acronym: '' });
      setShowConfirmModal(false);
      fetchData();
    } catch (err) {
      alert('Error saving office: ' + err.message);
      setShowConfirmModal(false);
    }
  };

  const handleDeleteOffice = (id) => {
    setConfirmConfig({
      title: 'Delete Office?',
      message: 'Are you sure you want to delete this office? All associated sections and reports will be removed. This action cannot be undone.',
      type: 'delete',
      action: () => executeDeleteOffice(id)
    });
    setShowConfirmModal(true);
  };

  const executeDeleteOffice = async (id) => {
    try {
      await deleteOffice(id);
      setShowConfirmModal(false);
      fetchData();
    } catch (err) {
      alert('Error deleting office: ' + err.message);
      setShowConfirmModal(false);
    }
  };

  const openOfficeModal = (office = null) => {
    setValidationError('');
    if (office) {
      setEditingOffice(office);
      setOfficeForm({ name: office.name, acronym: office.acronym || '' });
    } else {
      setEditingOffice(null);
      setOfficeForm({ name: '', acronym: '' });
    }
    setIsOfficeModalOpen(true);
  };

  // Section Handlers
  const handleSaveSection = async (e) => {
    e.preventDefault();
    setValidationError('');

    // Duplicate Check (Within same office)
    const nameExists = divisions.some(sec => 
      sec.name.toLowerCase().trim() === sectionForm.name.toLowerCase().trim() && 
      sec.officeId === sectionForm.officeId &&
      sec.id !== editingSection?.id
    );

    if (nameExists) {
      setValidationError('A section with this name already exists in the selected office.');
      return;
    }

    setConfirmConfig({
      title: editingSection ? 'Update Section?' : 'Add New Section?',
      message: editingSection 
        ? `Are you sure you want to save changes to ${editingSection.name}?`
        : `Are you sure you want to add "${sectionForm.name}" to the system?`,
      type: 'save_section',
      action: () => executeSaveSection()
    });
    setShowConfirmModal(true);
  };

  const executeSaveSection = async () => {
    try {
      if (editingSection) {
        await updateDivision(editingSection.id, sectionForm);
      } else {
        await createDivision(sectionForm);
      }
      setIsSectionModalOpen(false);
      setEditingSection(null);
      setSectionForm({ name: '', acronym: '', officeId: '' });
      setShowConfirmModal(false);
      fetchData();
    } catch (err) {
      alert('Error saving section: ' + err.message);
      setShowConfirmModal(false);
    }
  };

  const handleDeleteSection = (id) => {
    setConfirmConfig({
      title: 'Delete Section?',
      message: 'Are you sure you want to delete this section? All associated reports will be removed. This action cannot be undone.',
      type: 'delete',
      action: () => executeDeleteSection(id)
    });
    setShowConfirmModal(true);
  };

  const executeDeleteSection = async (id) => {
    try {
      await deleteDivision(id);
      setShowConfirmModal(false);
      fetchData();
    } catch (err) {
      alert('Error deleting section: ' + err.message);
      setShowConfirmModal(false);
    }
  };

  const openSectionModal = (section = null, officeId = '') => {
    setValidationError('');
    if (section) {
      setEditingSection(section);
      setSectionForm({ name: section.name, acronym: section.acronym || '', officeId: section.officeId });
    } else {
      setEditingSection(null);
      setSectionForm({ name: '', acronym: '', officeId: officeId });
    }
    setIsSectionModalOpen(true);
  };

  const totalOfficePages = Math.ceil(offices.length / itemsPerPage);
  const totalSectionPages = Math.ceil(divisions.length / itemsPerPage);
  
  const currentOffices = offices.slice((officePage - 1) * itemsPerPage, officePage * itemsPerPage);
  const currentSections = divisions.slice((sectionPage - 1) * itemsPerPage, sectionPage * itemsPerPage);

  const Pagination = ({ totalPages, currentPage, onPageChange }) => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-between px-8 py-4 border-t border-slate-50 bg-slate-50/30">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          Page {currentPage} of {totalPages}
        </p>
        <div className="flex gap-1.5">
          <button 
            disabled={currentPage === 1}
            onClick={() => onPageChange(currentPage - 1)}
            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all bg-white border border-slate-200 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed hover:border-moss-600 hover:text-moss-600 active:scale-95"
          >
            Prev
          </button>
          {[...Array(totalPages)].map((_, i) => (
            <button 
              key={i}
              onClick={() => onPageChange(i + 1)}
              className={`w-8 h-8 rounded-lg text-[10px] font-black transition-all flex items-center justify-center border ${
                currentPage === i + 1 
                  ? 'bg-moss-600 border-moss-600 text-white shadow-lg shadow-moss-600/20' 
                  : 'bg-white border-slate-200 text-slate-400 hover:border-moss-200 hover:text-slate-600'
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button 
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all bg-white border border-slate-200 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed hover:border-moss-600 hover:text-moss-600 active:scale-95"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  return (
    <ManagementLayout title="Office Management">
      <div className="space-y-8 animate-in fade-in duration-500">
        {/* Combined Navigation Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-2">
          {/* Enhanced Segmented Toggle */}
          <div className="flex bg-slate-100 p-1 rounded-2xl w-fit shadow-inner">
            <button 
              onClick={() => { setActiveTab('offices'); setOfficePage(1); }}
              className={`px-8 py-3 rounded-[1.1rem] font-black tracking-tight transition-all text-[12px] uppercase tracking-widest flex items-center gap-2 ${
                activeTab === 'offices' 
                  ? 'bg-white text-moss-600 shadow-md scale-100' 
                  : 'text-slate-400 hover:text-slate-600 scale-95'
              }`}
            >
              <Building2 size={16} className={activeTab === 'offices' ? 'text-moss-600' : 'text-slate-300'} />
              Offices
            </button>
            <button 
              onClick={() => { setActiveTab('sections'); setSectionPage(1); }}
              className={`px-8 py-3 rounded-[1.1rem] font-black tracking-tight transition-all text-[12px] uppercase tracking-widest flex items-center gap-2 ${
                activeTab === 'sections' 
                  ? 'bg-white text-moss-600 shadow-md scale-100' 
                  : 'text-slate-400 hover:text-slate-600 scale-95'
              }`}
            >
              <Layout size={16} className={activeTab === 'sections' ? 'text-moss-600' : 'text-slate-300'} />
              Sections
            </button>
          </div>
          <button 
            onClick={() => activeTab === 'offices' ? openOfficeModal() : openSectionModal()}
            className="bg-moss-600 hover:bg-moss-700 text-white font-black px-6 py-3.5 rounded-2xl flex items-center gap-2 transition-all shadow-lg shadow-moss-600/20 active:scale-95 text-[11px] font-black uppercase tracking-widest"
          >
            <Plus size={18} />
            Add New {activeTab === 'offices' ? 'Office' : 'Section'}
          </button>
        </div>

        {activeTab === 'offices' ? (
          /* Office Management Section */
          <section className="space-y-6 animate-in slide-in-from-left-4 duration-500">
            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50">
                      <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Office Name</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Acronym</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {currentOffices.map(office => (
                      <tr key={office.id} className="hover:bg-slate-50/30 transition-colors">
                        <td className="px-8 py-5 font-bold text-slate-800 text-[13px] leading-relaxed">
                          {office.name}
                        </td>
                        <td className="px-8 py-5 text-center">
                          {office.acronym && <span className="text-moss-600 font-extrabold text-[9px] bg-moss-50 px-2 py-0.5 rounded-lg border border-moss-100 uppercase tracking-tighter">{office.acronym}</span>}
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => openOfficeModal(office)} className="p-2 text-slate-400 hover:text-moss-600 hover:bg-moss-50 rounded-xl transition-all" title="Edit Office">
                              <Edit3 size={16} />
                            </button>
                            <button onClick={() => handleDeleteOffice(office.id)} className="p-2 text-slate-300 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all" title="Delete Office">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination totalPages={totalOfficePages} currentPage={officePage} onPageChange={setOfficePage} />
            </div>
          </section>
        ) : (
          /* Section Management Section */
          <section className="space-y-6 animate-in slide-in-from-right-4 duration-500">
            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50">
                      <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Section Name</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Acronym</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Parent Office</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {currentSections.map(section => (
                      <tr key={section.id} className="hover:bg-slate-50/30 transition-colors">
                        <td className="px-8 py-5 font-bold text-slate-800 text-[12px] leading-relaxed">
                          {section.name}
                        </td>
                        <td className="px-8 py-5 text-center">
                          {section.acronym && <span className="text-moss-600 font-extrabold text-[9px] bg-moss-50 px-2 py-0.5 rounded-lg border border-moss-100 uppercase tracking-wider">{section.acronym}</span>}
                        </td>
                        <td className="px-8 py-5">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-slate-200"></div>
                             {offices.find(o => o.id === section.officeId)?.name || 'Unknown Office'}
                          </div>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => openSectionModal(section)} className="p-2 text-slate-400 hover:text-moss-600 hover:bg-moss-50 rounded-xl transition-all" title="Edit Section">
                              <Edit3 size={16} />
                            </button>
                            <button onClick={() => handleDeleteSection(section.id)} className="p-2 text-slate-300 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all" title="Delete Section">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination totalPages={totalSectionPages} currentPage={sectionPage} onPageChange={setSectionPage} />
            </div>
          </section>
        )}

        {/* Office Modal */}
        {isOfficeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsOfficeModalOpen(false)}></div>
            <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-10 animate-in zoom-in-95 duration-200">
              <h3 className="text-2xl font-extrabold text-slate-900 mb-8 tracking-tight">
                {editingOffice ? 'Edit Office' : 'Add New Office'}
              </h3>
              <form onSubmit={handleSaveOffice} className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Office Name</label>
                  <input 
                    type="text" 
                    required
                    value={officeForm.name}
                    onChange={(e) => {
                      setOfficeForm({...officeForm, name: e.target.value});
                      if (validationError) setValidationError('');
                    }}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                    placeholder="e.g. Planning, Monitoring & Evaluation Division"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Acronym (Optional)</label>
                  <input 
                    type="text" 
                    value={officeForm.acronym}
                    onChange={(e) => setOfficeForm({...officeForm, acronym: e.target.value})}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                    placeholder="e.g. PMED"
                  />
                </div>

                {validationError && (
                  <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl animate-in fade-in zoom-in-95 duration-200">
                    <AlertCircle size={18} className="shrink-0" />
                    <span className="text-[11px] font-bold leading-tight">{validationError}</span>
                  </div>
                )}

                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsOfficeModalOpen(false)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-4 rounded-2xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-moss-600 hover:bg-moss-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-moss-600/20 transition-all"
                  >
                    Save Office
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Section Modal */}
        {isSectionModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsSectionModalOpen(false)}></div>
            <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-10 animate-in zoom-in-95 duration-200">
              <h3 className="text-2xl font-extrabold text-slate-900 mb-8 tracking-tight">
                {editingSection ? 'Edit Section' : 'Add New Section'}
              </h3>
              <form onSubmit={handleSaveSection} className="space-y-6">
                <div>
                  <SearchableSelect 
                    label="Belongs to Office"
                    options={offices}
                    value={sectionForm.officeId}
                    onChange={(val) => setSectionForm({...sectionForm, officeId: val})}
                    placeholder="Select Parent Office..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Section Name</label>
                  <input 
                    type="text" 
                    required
                    value={sectionForm.name}
                    onChange={(e) => {
                      setSectionForm({...sectionForm, name: e.target.value});
                      if (validationError) setValidationError('');
                    }}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                    placeholder="e.g. Information Management Section"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Acronym (Optional)</label>
                  <input 
                    type="text" 
                    value={sectionForm.acronym}
                    onChange={(e) => setSectionForm({...sectionForm, acronym: e.target.value})}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-moss-600/10 focus:border-moss-600 transition-all outline-none"
                    placeholder="e.g. IMS"
                  />
                </div>

                {validationError && (
                  <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl animate-in fade-in zoom-in-95 duration-200">
                    <AlertCircle size={18} className="shrink-0" />
                    <span className="text-[11px] font-bold leading-tight">{validationError}</span>
                  </div>
                )}

                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsSectionModalOpen(false)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-4 rounded-2xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-moss-600 hover:bg-moss-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-moss-600/20 transition-all"
                  >
                    Save Section
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
            <div className="relative w-full max-w-sm bg-white rounded-[2rem] shadow-2xl p-8 animate-in zoom-in-95 duration-200 text-center border border-white/20">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 ${
                confirmConfig.type === 'delete' ? 'bg-red-50' : 'bg-moss-50'
              }`}>
                {confirmConfig.type === 'delete' ? (
                  <Trash2 className="text-red-600 w-8 h-8" />
                ) : confirmConfig.type === 'save_section' ? (
                  <Layout className="text-moss-600 w-8 h-8" />
                ) : (
                  <Building2 className="text-moss-600 w-8 h-8" />
                )}
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">{confirmConfig.title}</h3>
              <p className="text-slate-500 text-sm mb-8 leading-relaxed px-2">
                {confirmConfig.message}
              </p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3.5 rounded-xl transition-all text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmConfig.action}
                  className={`flex-1 text-white font-bold py-3.5 rounded-xl shadow-lg transition-all active:scale-95 text-sm ${
                    confirmConfig.type === 'delete' 
                      ? 'bg-red-600 hover:bg-red-700 shadow-red-600/20' 
                      : 'bg-moss-600 hover:bg-moss-700 shadow-moss-600/20'
                  }`}
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

export default OfficeDivisionManagement;
