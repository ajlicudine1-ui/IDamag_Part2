import React, { useState, useEffect } from 'react';
import ManagementLayout from '../../components/management/ManagementLayout';
import { getActivityLogs } from '../../services/api';
import { History, Search, Filter, Calendar, User, Activity, Globe, Info } from 'lucide-react';

const formatLogDate = (dateString) => {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date).replace(',', ' •');
};

function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('All');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [limit] = useState(10);

  useEffect(() => {
    fetchLogs();
  }, [currentPage, actionFilter]); // Re-fetch on page or filter change

  // Reset to page 1 on search
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = {
        page: currentPage,
        limit,
        action: actionFilter !== 'All' ? actionFilter : undefined,
        search: searchTerm || undefined
      };
      
      const response = await getActivityLogs(params);
      setLogs(response.data.logs);
      setTotalPages(response.data.totalPages);
      setTotalCount(response.data.totalCount);
    } catch (err) {
      setError('Failed to load activity logs.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (action) => {
    if (action.includes('DELETE') || action.includes('REMOVE') || action.includes('FAIL')) return 'text-red-600 bg-red-50 border-red-100';
    if (action.includes('ADD') || action.includes('SUCCESS') || action.includes('ACTIVATE') || action.includes('REGISTRATION')) return 'text-green-600 bg-green-50 border-green-100';
    if (action.includes('EDIT') || action.includes('UPDATE') || action.includes('CHANGE')) return 'text-blue-600 bg-blue-50 border-blue-100';
    if (action.includes('ATTEMPT') || action.includes('DEACTIVATE') || action.includes('BLOCKED')) return 'text-amber-600 bg-amber-50 border-amber-100';
    return 'text-slate-600 bg-slate-50 border-slate-100';
  };

  const actionTypes = ['All', 'LOGIN_SUCCESS', 'LOGIN_ATTEMPT', 'REGISTRATION', 'LOGOUT', 'ADD_USER', 'EDIT_USER', 'REMOVE_USER', 'ACTIVATE_USER', 'DEACTIVATE_USER', 'ADD_REPORT', 'EDIT_REPORT', 'DELETE_REPORT', 'ADD_OFFICE', 'EDIT_OFFICE', 'DELETE_OFFICE', 'ADD_SECTION', 'EDIT_SECTION', 'DELETE_SECTION', 'CHANGE_PASSWORD'];

  // Manual search filtering on the current page's results for instant feedback
  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.user && `${log.user.firstName} ${log.user.lastName}`.toLowerCase().includes(searchTerm.toLowerCase())) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  return (
    <ManagementLayout title="Activity Logs">
      <div className="space-y-6">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 max-w-2xl">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Search logs by description, user, or action..."
                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-moss-600/5 focus:border-moss-600 transition-all font-medium text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="relative min-w-[200px]">
              <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <select 
                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-moss-600/5 focus:border-moss-600 transition-all font-medium text-sm appearance-none cursor-pointer"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              >
                {actionTypes.map(type => (
                  <option key={type} value={type}>{type === 'All' ? 'All Actions' : type.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </div>
          
          <button 
            onClick={fetchLogs}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-600 font-bold text-sm rounded-2xl hover:bg-slate-50 transition-all active:scale-95"
          >
            <History size={18} />
            Refresh Logs
          </button>
        </div>

        {/* Table Section */}
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="px-5 py-3 text-left text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 w-[160px]">Timestamp</th>
                  <th className="px-5 py-3 text-left text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 w-[180px]">User</th>
                  <th className="px-5 py-3 text-left text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 w-[130px]">Action</th>
                  <th className="px-5 py-3 text-left text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">Description</th>
                  <th className="px-5 py-3 text-left text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 w-[100px]">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 border-4 border-moss-100 border-t-moss-600 rounded-full animate-spin"></div>
                        <p className="text-slate-400 font-bold text-sm">Loading activity logs...</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                          <History size={32} className="text-slate-200" />
                        </div>
                        <div>
                          <p className="text-slate-800 font-bold">No logs found</p>
                          <p className="text-slate-400 text-sm mt-1">Try adjusting your search or filters.</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-slate-500 font-medium text-[10px]">
                          <Calendar size={10} className="text-slate-300" />
                          {formatLogDate(log.createdAt)}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        {log.user ? (
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded bg-moss-50 border border-moss-100 flex items-center justify-center text-moss-700 font-bold text-[9px] flex-shrink-0">
                              {log.user.firstName?.[0]}{log.user.lastName?.[0]}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-slate-700 font-bold text-[11px] truncate leading-tight">
                                {log.user.firstName} {log.user.lastName}
                              </span>
                              <span className="text-slate-400 text-[9px] truncate leading-none">{log.user.email}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-slate-400 italic text-[10px] font-medium leading-none">
                            <User size={10} />
                            System
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-lg border text-[8px] font-black uppercase tracking-widest shadow-sm ${getActionColor(log.action)}`}>
                          {log.action.replace(/_/g, ' ').replace('SUCCESS', '').replace('ATTEMPT', '').trim() || log.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 min-w-[150px]">
                        <div className="flex items-center gap-1.5 text-slate-600 font-bold text-[11px] truncate" title={log.description}>
                          <Info size={10} className="text-slate-300 flex-shrink-0" />
                          {log.description}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap text-right">
                        <div className="text-slate-400 font-mono text-[9px]">
                          {log.ipAddress || '0.0.0.0'}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Bar */}
          {!loading && totalCount > 0 && (
            <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                Showing <span className="text-slate-600">{(currentPage - 1) * limit + 1}</span> to <span className="text-slate-600">{Math.min(currentPage * limit, totalCount)}</span> of <span className="text-slate-600">{totalCount}</span>
              </div>
              
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className={`px-3 py-1.5 rounded-lg font-bold text-[10px] transition-all ${
                    currentPage === 1 
                      ? 'bg-white text-slate-200 border border-slate-100 cursor-not-allowed' 
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 active:scale-95 shadow-sm'
                  }`}
                >
                  Prev
                </button>
                
                <div className="flex items-center gap-1">
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    const pageNum = totalPages <= 5 ? i + 1 : (
                      currentPage <= 3 ? i + 1 : (
                        currentPage >= totalPages - 2 ? totalPages - 4 + i : currentPage - 2 + i
                      )
                    );
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-7 h-7 rounded-lg font-black text-[10px] transition-all ${
                          currentPage === pageNum
                            ? 'bg-moss-600 text-white shadow-md shadow-moss-600/20'
                            : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50 hover:text-slate-600'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button 
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className={`px-3 py-1.5 rounded-lg font-bold text-[10px] transition-all ${
                    currentPage === totalPages 
                      ? 'bg-white text-slate-200 border border-slate-100 cursor-not-allowed' 
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 active:scale-95 shadow-sm'
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ManagementLayout>
  );
}

export default ActivityLog;
