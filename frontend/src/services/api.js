import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

// Interceptor to add User ID for activity logging
api.interceptors.request.use((config) => {
  const storedUser = localStorage.getItem('user');

  if (storedUser) {
    const user = JSON.parse(storedUser);

    if (user?.id) {
      config.headers['X-User-Id'] = user.id;
    }
  }

  return config;
}, (error) => {
  return Promise.reject(error);
});

// Auth
export const login = (data) => api.post('/login', data);

// Offices
export const getOffices = () => api.get('/offices');
export const createOffice = (data) => api.post('/offices', data);
export const updateOffice = (id, data) => api.put(`/offices/${id}`, data);
export const deleteOffice = (id) => api.delete(`/offices/${id}`);

// Divisions
export const getDivisions = (officeId) => {
  const url = officeId ? `/divisions?officeId=${officeId}` : '/divisions';
  return api.get(url);
};

export const createDivision = (data) => api.post('/divisions', data);
export const updateDivision = (id, data) => api.put(`/divisions/${id}`, data);
export const deleteDivision = (id) => api.delete(`/divisions/${id}`);

// Reports
export const getReports = (params) => {
  const query = new URLSearchParams(params).toString();
  return api.get(`/reports?${query}`);
};

export const createReport = (data) => api.post('/reports', data);
export const updateReport = (id, data) => api.put(`/reports/${id}`, data);
export const deleteReport = (id) => api.delete(`/reports/${id}`);

// Users
export const getUsers = () => api.get('/users');
export const createUser = (data) => api.post('/users', data);
export const updateUser = (id, data) => api.put(`/users/${id}`, data);
export const deleteUser = (id) => api.delete(`/users/${id}`);
export const updateUserStatus = (id, isActive) =>
  api.patch(`/users/${id}/status`, { isActive });

export const changePassword = (id, data) =>
  api.put(`/users/${id}/password`, data);

// Activity Logs
export const getActivityLogs = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return api.get(`/activity-logs?${query}`);
};

export const logLogout = (userData) => api.post('/logout', userData);

export default api;