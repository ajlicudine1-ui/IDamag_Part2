import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ManagementLayout from "../../components/management/ManagementLayout";
import SearchableSelect from "../../components/common/SearchableSelect";

import {
  getOffices,
  getDivisions,
  getReports,
  createReport,
  updateReport,
  deleteReport,
} from "../../services/api";

import {
  Plus,
  Layout,
  FileText,
  ExternalLink,
  Trash2,
  Edit3,
  AlertCircle,
  Building2,
  FileBarChart,
  Sheet,
  Link as LinkIcon,
  Hash,
  X,
} from "lucide-react";

function StaffDashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);

  const [offices, setOffices] = useState([]);
  const [selectedOffice, setSelectedOffice] = useState("");

  const [divisions, setDivisions] = useState([]);
  const [selectedDivision, setSelectedDivision] = useState("");

  const [reports, setReports] = useState([]);

  // =========================================================
  // REPORT MODAL
  // =========================================================

  const [isModalOpen, setIsModalOpen] = useState(false);

  const [editingReport, setEditingReport] = useState(null);

  const [reportForm, setReportForm] = useState({
    title: "",
    url: "",
    description: "",
  });

  const [formError, setFormError] = useState("");

  // =========================================================
  // WORKSHEET MODAL
  // =========================================================

  const [isWorksheetModalOpen, setIsWorksheetModalOpen] =
    useState(false);

  const [worksheetSaving, setWorksheetSaving] =
    useState(false);

  const [worksheetError, setWorksheetError] =
    useState("");

  const [worksheetForm, setWorksheetForm] = useState({
    reportId: "",
    sheetUrl: "",
    worksheets: [
      {
        worksheetName: "",
        gid: "",
      },
    ],
  });

  // =========================================================
  // CONFIRMATION
  // =========================================================

  const [showConfirmModal, setShowConfirmModal] =
    useState(false);

  const [confirmConfig, setConfirmConfig] = useState({
    title: "",
    message: "",
    action: null,
  });

  // =========================================================
  // OTHER STATES
  // =========================================================

  const [loading, setLoading] = useState(true);

  const [previewId, setPreviewId] =
    useState(null);

  const [viewingReport, setViewingReport] =
    useState(null);

  // =========================================================
  // API URL
  // =========================================================

  const RAW_API_URL = (
    import.meta.env.VITE_API_URL ||
    "http://localhost:5000/api"
  ).replace(/\/+$/, "");

  const API_URL = RAW_API_URL.endsWith("/api")
    ? RAW_API_URL
    : `${RAW_API_URL}/api`;

  /*
   * IMPORTANT:
   * Change only this path if your existing worksheet route
   * uses a different URL.
   *
   * Example:
   * /api/worksheets
   * /api/chatbot/worksheets
   */
  const WORKSHEET_API_URL =
    `${API_URL}/worksheets`;

  // =========================================================
  // POWER BI HELPERS
  // =========================================================

  const extractReportId = (input) => {
    if (!input) return "";

    if (!input.includes("http")) {
      return input;
    }

    try {
      const url = new URL(input);

      return url.searchParams.get("r") || "";
    } catch (e) {
      return "";
    }
  };

  const getFullPowerBiUrl = (id) => {
    if (!id) return "";

    return `https://app.powerbi.com/view?r=${id}`;
  };

  // =========================================================
  // USER
  // =========================================================

  useEffect(() => {
    const storedUser = JSON.parse(
      localStorage.getItem("user")
    );

    setUser(storedUser);
    setLoading(false);
  }, []);

  // =========================================================
  // LOAD OFFICES
  // =========================================================

  useEffect(() => {
    if (!user) return;

    if (user.role === "Admin") {
      getOffices().then((res) => {
        setOffices(res.data);

        setSelectedOffice(
          user.officeId
        );
      });
    } else {
      setSelectedOffice(
        user.officeId
      );

      setSelectedDivision(
        user.divisionId
      );
    }
  }, [user]);

  // =========================================================
  // LOAD DIVISIONS
  // =========================================================

  useEffect(() => {
    if (!selectedOffice) return;

    getDivisions(selectedOffice).then(
      (res) => {
        setDivisions(res.data);

        if (
          selectedOffice !==
          user?.officeId
        ) {
          setSelectedDivision("");
        } else if (!selectedDivision) {
          setSelectedDivision("");
        }
      }
    );
  }, [selectedOffice, user]);

  // =========================================================
  // LOAD REPORTS
  // =========================================================

  useEffect(() => {
    if (!selectedOffice) return;

    const params = {
      officeId: selectedOffice,
    };

    if (selectedDivision) {
      params.divisionId =
        selectedDivision;
    }

    getReports(params).then((res) => {
      setReports(res.data);
    });
  }, [
    selectedOffice,
    selectedDivision,
  ]);

  // =========================================================
  // SAVE REPORT
  // =========================================================

  const handleSaveReport = async (e) => {
    if (e) e.preventDefault();

    if (!showConfirmModal) {
      setConfirmConfig({
        title: editingReport
          ? "Update Report?"
          : "Add New Report?",

        message: editingReport
          ? "Are you sure you want to save the changes to this report?"
          : "Are you sure you want to publish this new report to the dashboard?",

        action: () => executeSave(),
      });

      setShowConfirmModal(true);

      return;
    }
  };

  const executeSave = async () => {
    try {
      setFormError("");

      const reportId =
        extractReportId(
          reportForm.url
        );

      if (!reportId) {
        setFormError(
          'Invalid Power BI URL. Please provide a valid "Publish to Web" link.'
        );

        setShowConfirmModal(false);

        return;
      }

      const reportData = {
        title: reportForm.title,

        reportId,

        description:
          reportForm.description,

        divisionId:
          selectedDivision ||
          user?.divisionId,
      };

      if (!reportData.divisionId) {
        setFormError(
          "Please select a division."
        );

        setShowConfirmModal(false);

        return;
      }

      if (editingReport) {
        await updateReport(
          editingReport.id,
          reportData
        );
      } else {
        await createReport(
          reportData
        );
      }

      setIsModalOpen(false);

      setShowConfirmModal(false);

      setEditingReport(null);

      setReportForm({
        title: "",
        url: "",
        description: "",
      });

      const res =
        await getReports({
          divisionId:
            selectedDivision,
        });

      setReports(res.data);
    } catch (err) {
      alert(
        "Error saving report: " +
          err.message
      );

      setShowConfirmModal(false);
    }
  };

  // =========================================================
  // DELETE REPORT
  // =========================================================

  const handleDeleteReport = (id) => {
    setConfirmConfig({
      title: "Delete Report?",

      message:
        "This action cannot be undone. Are you sure you want to permanently remove this report?",

      action: () =>
        executeDelete(id),
    });

    setShowConfirmModal(true);
  };

  const executeDelete = async (id) => {
    try {
      await deleteReport(id);

      setReports(
        reports.filter(
          (r) => r.id !== id
        )
      );

      setShowConfirmModal(false);
    } catch (err) {
      alert(
        "Error deleting report: " +
          err.message
      );

      setShowConfirmModal(false);
    }
  };

  // =========================================================
  // EDIT REPORT
  // =========================================================

  const openEditModal = (report) => {
    setEditingReport(report);

    setReportForm({
      title: report.title,

      url:
        getFullPowerBiUrl(
          report.reportId
        ),

      description:
        report.description,
    });

    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);

    setEditingReport(null);

    setReportForm({
      title: "",
      url: "",
      description: "",
    });

    setFormError("");
  };

  // =========================================================
  // WORKSHEET MODAL
  // =========================================================

  const openWorksheetModal = () => {
    setWorksheetError("");

    setWorksheetForm({
      reportId: "",
      sheetUrl: "",
      worksheets: [
        {
          worksheetName: "",
          gid: "",
        },
      ],
    });

    setIsWorksheetModalOpen(
      true
    );
  };

  const closeWorksheetModal = () => {
    setIsWorksheetModalOpen(
      false
    );

    setWorksheetError("");

    setWorksheetForm({
      reportId: "",
      sheetUrl: "",
      worksheets: [
        {
          worksheetName: "",
          gid: "",
        },
      ],
    });
  };

  // =========================================================
  // ADD WORKSHEET ROW
  // =========================================================

  const addWorksheetRow = () => {
    setWorksheetForm(
      (current) => ({
        ...current,

        worksheets: [
          ...current.worksheets,

          {
            worksheetName: "",
            gid: "",
          },
        ],
      })
    );
  };

  // =========================================================
  // REMOVE WORKSHEET ROW
  // =========================================================

  const removeWorksheetRow = (
    index
  ) => {
    setWorksheetForm(
      (current) => ({
        ...current,

        worksheets:
          current.worksheets.filter(
            (_, i) => i !== index
          ),
      })
    );
  };

  // =========================================================
  // UPDATE WORKSHEET ROW
  // =========================================================

  const updateWorksheetRow = (
    index,
    field,
    value
  ) => {
    setWorksheetForm(
      (current) => ({
        ...current,

        worksheets:
          current.worksheets.map(
            (worksheet, i) =>
              i === index
                ? {
                    ...worksheet,

                    [field]:
                      value,
                  }
                : worksheet
          ),
      })
    );
  };

  // =========================================================
  // VALIDATE GOOGLE SHEET URL
  // =========================================================

  const isValidSheetUrl = (
    value
  ) => {
    if (!value) return false;

    return (
      value.includes(
        "docs.google.com/spreadsheets"
      ) ||
      value.includes(
        "docs.google.com"
      )
    );
  };

  // =========================================================
  // SAVE WORKSHEETS
  // =========================================================

  const handleSaveWorksheets =
    async (e) => {
      e.preventDefault();

      setWorksheetError("");

      if (
        !worksheetForm.reportId
      ) {
        setWorksheetError(
          "Please select a Power BI report."
        );

        return;
      }

      if (
        !isValidSheetUrl(
          worksheetForm.sheetUrl
        )
      ) {
        setWorksheetError(
          "Please enter a valid published Google Sheet link."
        );

        return;
      }

      if (
        worksheetForm.worksheets
          .length === 0
      ) {
        setWorksheetError(
          "Add at least one worksheet."
        );

        return;
      }

      const invalidWorksheet =
        worksheetForm.worksheets.find(
          (worksheet) =>
            !worksheet.worksheetName.trim() ||
            worksheet.gid === ""
        );

      if (invalidWorksheet) {
        setWorksheetError(
          "Every worksheet must have a Sheet/Page Name and GID."
        );

        return;
      }

      try {
        setWorksheetSaving(true);

        /*
         * Save each worksheet as its own row.
         *
         * This does NOT require changing your
         * database structure.
         */
        for (
          const worksheet of
          worksheetForm.worksheets
        ) {
          const response =
            await fetch(
              WORKSHEET_API_URL,
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body: JSON.stringify({
                  /*
                   * Selected Power BI report.
                   *
                   * report.id = normal database
                   * report row ID.
                   */
                  dashboardId:
                    Number(
                      worksheetForm.reportId
                    ),

                  /*
                   * Published Google Sheet.
                   */
                  sheetUrl:
                    worksheetForm.sheetUrl.trim(),

                  /*
                   * Existing worksheet table
                   * fields.
                   */
                  worksheetName:
                    worksheet.worksheetName.trim(),

                  gid:
                    String(
                      worksheet.gid
                    ).trim(),
                }),
              }
            );

          if (!response.ok) {
            const text =
              await response.text();

            throw new Error(
              text ||
                `Unable to save ${worksheet.worksheetName}.`
            );
          }
        }

        closeWorksheetModal();

        alert(
          "Worksheets saved successfully."
        );
      } catch (error) {
        console.error(
          "Worksheet save error:",
          error
        );

        setWorksheetError(
          error.message ||
            "Unable to save worksheets."
        );
      } finally {
        setWorksheetSaving(false);
      }
    };

  // =========================================================
  // LOADING
  // =========================================================

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="animate-pulse font-bold text-slate-400">
          Verifying Session...
        </div>
      </div>
    );
  }

  return (
    <ManagementLayout
      title={
        user?.role === "Admin"
          ? "Management: Admin"
          : `Management: ${
              user.office
                ?.acronym ||
              "My Office"
            }`
      }
    >
      <div className="space-y-8 animate-in fade-in duration-500">

        {/* ===================================================
            HEADER STATS
        =================================================== */}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">

          <div className="group relative flex items-center gap-6 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm md:col-span-2">

            <div className="relative z-10 flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-moss-100/50">

              <Building2 className="h-8 w-8 text-moss-600" />

            </div>

            <div className="relative z-10 flex-grow">

              {user.role ===
              "Admin" ? (
                <div className="space-y-4">

                  <SearchableSelect
                    label="Office"
                    variant="ghost"
                    options={offices}
                    value={
                      selectedOffice
                    }
                    onChange={
                      setSelectedOffice
                    }
                    placeholder="Search Office..."
                  />

                  <SearchableSelect
                    variant="ghost"
                    options={[
                      {
                        id: "",
                        name:
                          "All Sections",
                      },
                      ...divisions,
                    ]}
                    value={
                      selectedDivision
                    }
                    onChange={
                      setSelectedDivision
                    }
                    placeholder="All Sections"
                  />

                </div>
              ) : (
                <>
                  <p className="mb-2 text-[10px] font-black uppercase leading-none tracking-[0.2em] text-slate-400">
                    Office
                  </p>

                  <h3 className="mb-1 text-lg font-black leading-tight text-slate-900">

                    {
                      user.office
                        ?.name
                    }

                    <span className="ml-1 text-moss-600">
                      (
                      {
                        user.office
                          ?.acronym
                      }
                      )
                    </span>

                  </h3>

                  <p className="flex items-center gap-2 text-sm font-bold text-slate-500">

                    {
                      user.division
                        ?.name
                    }

                  </p>
                </>
              )}

            </div>

          </div>

          <div className="flex items-center gap-4 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">

            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-moss-50">

              <FileText className="h-6 w-6 text-moss-600" />

            </div>

            <div>

              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Reports
              </p>

              <p className="font-extrabold text-slate-900">
                {reports.length} Published
              </p>

            </div>

          </div>

        </div>

        {/* ===================================================
            REPORTS
        =================================================== */}

        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">

          <div className="flex flex-col gap-4 border-b border-slate-50 bg-slate-50/20 px-8 py-6 lg:flex-row lg:items-center lg:justify-between">

            <div>

              <h3 className="flex items-center gap-3 text-xl font-black leading-tight tracking-tight text-slate-900">

                <Layout
                  size={24}
                  className="text-moss-600"
                />

                Reports Management

              </h3>

            </div>

            <div className="flex flex-wrap items-center gap-3">

              {user.role ===
                "Admin" &&
                !selectedDivision && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-1.5 text-[10px] font-bold text-amber-500">

                    <AlertCircle
                      size={12}
                    />

                    Select a specific
                    section to add
                    reports

                  </div>
                )}

              {/* ADD WORKSHEET */}

              <button
                type="button"
                onClick={
                  openWorksheetModal
                }
                disabled={
                  reports.length === 0
                }
                className={`
                  flex
                  items-center
                  gap-2
                  rounded-2xl
                  px-5
                  py-3.5
                  text-[11px]
                  font-black
                  uppercase
                  tracking-widest
                  transition-all
                  active:scale-95

                  ${
                    reports.length ===
                    0
                      ? "cursor-not-allowed bg-slate-100 text-slate-400"
                      : "border border-moss-200 bg-moss-50 text-moss-700 hover:bg-moss-100"
                  }
                `}
              >

                <Sheet size={18} />

                Add Worksheet

              </button>

              {/* ADD REPORT */}

              <button
                onClick={() =>
                  setIsModalOpen(
                    true
                  )
                }
                disabled={
                  user.role ===
                    "Admin" &&
                  !selectedDivision
                }
                className={`flex items-center gap-2 rounded-2xl px-6 py-3.5 text-[11px] font-black uppercase tracking-widest shadow-lg transition-all active:scale-95 ${
                  user.role ===
                    "Admin" &&
                  !selectedDivision
                    ? "cursor-not-allowed bg-slate-100 text-slate-400 shadow-none"
                    : "bg-moss-600 text-white shadow-moss-600/20 hover:bg-moss-700"
                }`}
              >

                <Plus size={18} />

                Add New Report

              </button>

            </div>

          </div>

          {/* TABLE */}

          <div className="overflow-x-auto">

            <table className="w-full text-left">

              <thead>

                <tr className="bg-slate-50/50">

                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Report Title
                  </th>

                  <th className="px-8 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Power BI URL
                  </th>

                  <th className="px-8 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Date Added
                  </th>

                  <th className="px-8 py-4 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Actions
                  </th>

                </tr>

              </thead>

              <tbody className="divide-y divide-slate-100">

                {reports.length ===
                0 ? (
                  <tr>

                    <td
                      colSpan="4"
                      className="px-8 py-12 text-center font-medium text-slate-400"
                    >

                      No reports found for
                      this division.

                    </td>

                  </tr>
                ) : (
                  reports.map(
                    (report) => (
                      <tr
                        key={
                          report.id
                        }
                        className="transition-colors hover:bg-slate-50/30"
                      >

                        <td className="px-8 py-4">

                          <div className="text-[13px] font-bold leading-relaxed text-slate-800">

                            {
                              report.title
                            }

                          </div>

                          <div className="flex max-w-xs items-center truncate">

                            <span className="max-w-[150px] truncate text-[10px] font-bold uppercase tracking-tight text-slate-400 opacity-70">

                              {report.description ||
                                "No description provided"}

                            </span>

                            {report.description &&
                              report
                                .description
                                .length >
                                30 && (
                                <button
                                  onClick={() =>
                                    setViewingReport(
                                      report
                                    )
                                  }
                                  className="ml-2 whitespace-nowrap rounded-md bg-moss-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-moss-600 transition-colors hover:bg-moss-100 hover:text-moss-700"
                                >

                                  Read More

                                </button>
                              )}

                          </div>

                        </td>

                        <td className="px-8 py-4 text-center">

                          <button
                            onClick={() =>
                              setPreviewId(
                                report.reportId
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-moss-100/50 bg-moss-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-moss-600 transition-all hover:bg-moss-100"
                          >

                            <ExternalLink
                              size={12}
                            />

                            Preview

                          </button>

                        </td>

                        <td className="px-8 py-4 text-center">

                          <span className="rounded-md border border-slate-100 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-500">

                            {new Date(
                              report.createdAt
                            ).toLocaleDateString()}

                          </span>

                        </td>

                        <td className="px-8 py-4 text-right">

                          <div className="flex items-center justify-end gap-1.5">

                            <button
                              onClick={() =>
                                openEditModal(
                                  report
                                )
                              }
                              className="rounded-xl p-2 text-slate-300 transition-all hover:bg-moss-50 hover:text-moss-600"
                              title="Edit"
                            >

                              <Edit3
                                size={16}
                              />

                            </button>

                            <button
                              onClick={() =>
                                handleDeleteReport(
                                  report.id
                                )
                              }
                              className="rounded-xl p-2 text-slate-200 transition-all hover:bg-red-50 hover:text-red-500"
                              title="Delete"
                            >

                              <Trash2
                                size={16}
                              />

                            </button>

                          </div>

                        </td>

                      </tr>
                    )
                  )
                )}

              </tbody>

            </table>

          </div>

        </div>

        {/* ===================================================
            ADD / EDIT POWER BI REPORT MODAL
        =================================================== */}

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">

            <div
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              onClick={
                closeModal
              }
            />

            <div className="relative w-full max-w-md rounded-[2.5rem] border border-white/20 bg-white p-10 shadow-2xl animate-in zoom-in-95 duration-200">

              <h3 className="mb-8 text-xl font-black tracking-tight text-slate-900">

                {editingReport
                  ? "Edit Power BI Report"
                  : "Add New Power BI Report"}

              </h3>

              <form
                onSubmit={
                  handleSaveReport
                }
                className="space-y-5"
              >

                {/* TITLE */}

                <div>

                  <label className="mb-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">

                    <FileText
                      size={12}
                      className="text-moss-600"
                    />

                    Report Title

                  </label>

                  <input
                    type="text"
                    required
                    value={
                      reportForm.title
                    }
                    onChange={(e) =>
                      setReportForm({
                        ...reportForm,
                        title:
                          e.target
                            .value,
                      })
                    }
                    className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-5 py-3.5 text-[13px] font-bold outline-none transition-all focus:border-moss-600 focus:ring-4 focus:ring-moss-600/10"
                    placeholder="e.g. 2024 Production Forecast"
                  />

                </div>

                {/* URL */}

                <div>

                  <label className="mb-1.5 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">

                    <div className="flex items-center gap-2">

                      <ExternalLink
                        size={12}
                        className="text-moss-600"
                      />

                      Power BI Embed URL

                    </div>

                    {extractReportId(
                      reportForm.url
                    ) && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewId(
                            extractReportId(
                              reportForm.url
                            )
                          )
                        }
                        className="flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[9px] font-black lowercase text-moss-600 transition-all hover:bg-moss-50"
                      >

                        <ExternalLink
                          size={10}
                        />

                        Preview

                      </button>
                    )}

                  </label>

                  <input
                    type="text"
                    required
                    value={
                      reportForm.url
                    }
                    onChange={(e) => {
                      setReportForm({
                        ...reportForm,

                        url:
                          e.target
                            .value,
                      });

                      if (formError) {
                        setFormError(
                          ""
                        );
                      }
                    }}
                    className={`w-full rounded-2xl border bg-slate-50 px-5 py-3.5 text-[13px] font-bold outline-none transition-all ${
                      formError
                        ? "border-red-400 ring-4 ring-red-500/10"
                        : "border-slate-100 focus:border-moss-600 focus:ring-4 focus:ring-moss-600/10"
                    }`}
                    placeholder="https://app.powerbi.com/view?r=..."
                  />

                  {formError && (
                    <p className="mt-2 flex items-center gap-1.5 text-[10px] font-bold text-red-500">

                      <AlertCircle
                        size={14}
                      />

                      {formError}

                    </p>
                  )}

                </div>

                {/* DESCRIPTION */}

                <div>

                  <label className="mb-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">

                    <Edit3
                      size={12}
                      className="text-moss-600"
                    />

                    Description
                    (Optional)

                  </label>

                  <textarea
                    value={
                      reportForm.description
                    }
                    onChange={(e) =>
                      setReportForm({
                        ...reportForm,

                        description:
                          e.target
                            .value,
                      })
                    }
                    className="w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-5 py-3.5 text-[13px] font-bold outline-none transition-all focus:border-moss-600 focus:ring-4 focus:ring-moss-600/10"
                    rows="2"
                    placeholder="Briefly describe what this report covers..."
                  />

                </div>

                <div className="flex gap-4 pt-4">

                  <button
                    type="button"
                    onClick={
                      closeModal
                    }
                    className="flex-1 rounded-2xl bg-slate-50 py-4 text-[11px] font-black uppercase tracking-widest text-slate-400 transition-all hover:bg-slate-100"
                  >

                    Cancel

                  </button>

                  <button
                    type="submit"
                    className="flex-1 rounded-2xl bg-moss-600 py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-moss-600/20 transition-all hover:bg-moss-700"
                  >

                    Save Report

                  </button>

                </div>

              </form>

            </div>

          </div>
        )}

        {/* ===================================================
            ADD WORKSHEET MODAL
        =================================================== */}

        {isWorksheetModalOpen && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">

            {/* BACKDROP */}

            <div
              className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm"
              onClick={
                closeWorksheetModal
              }
            />

            {/* MODAL */}

            <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2.5rem] border border-white/20 bg-white shadow-2xl animate-in zoom-in-95 duration-200">

              {/* HEADER */}

              <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-8 py-6">

                <div className="flex items-center gap-4">

                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-moss-50">

                    <Sheet className="h-6 w-6 text-moss-600" />

                  </div>

                  <div>

                    <h3 className="text-xl font-black tracking-tight text-slate-900">

                      Add Worksheets

                    </h3>

                    <p className="mt-1 text-xs font-medium text-slate-400">

                      Connect Google Sheet pages
                      to a Power BI report.

                    </p>

                  </div>

                </div>

                <button
                  type="button"
                  onClick={
                    closeWorksheetModal
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >

                  <X size={20} />

                </button>

              </div>

              {/* FORM */}

              <form
                onSubmit={
                  handleSaveWorksheets
                }
                className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
              >

                <div className="space-y-6">

                  {/* POWER BI REPORT */}

                  <div>

                    <label className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">

                      <FileBarChart
                        size={13}
                        className="text-moss-600"
                      />

                      Power BI Report

                    </label>

                    <select
                      required
                      value={
                        worksheetForm.reportId
                      }
                      onChange={(e) =>
                        setWorksheetForm(
                          (current) => ({
                            ...current,

                            reportId:
                              e
                                .target
                                .value,
                          })
                        )
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-700 outline-none transition focus:border-moss-600 focus:ring-4 focus:ring-moss-600/10"
                    >

                      <option value="">
                        Select Power BI Report
                      </option>

                      {reports.map(
                        (report) => (
                          <option
                            key={
                              report.id
                            }
                            value={
                              report.id
                            }
                          >

                            {
                              report.title
                            }

                          </option>
                        )
                      )}

                    </select>

                  </div>

                  {/* GOOGLE SHEET URL */}

                  <div>

                    <label className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">

                      <LinkIcon
                        size={13}
                        className="text-moss-600"
                      />

                      Published Google Sheet Link

                    </label>

                    <input
                      type="url"
                      required
                      value={
                        worksheetForm.sheetUrl
                      }
                      onChange={(e) =>
                        setWorksheetForm(
                          (current) => ({
                            ...current,

                            sheetUrl:
                              e
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-700 outline-none transition placeholder:font-medium placeholder:text-slate-300 focus:border-moss-600 focus:ring-4 focus:ring-moss-600/10"
                    />

                  </div>

                  {/* WORKSHEETS */}

                  <div>

                    <div className="mb-3 flex items-center justify-between">

                      <div>

                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">

                          Sheet / Page Details

                        </p>

                        <p className="mt-1 text-[11px] font-medium text-slate-400">

                          Add every worksheet used by
                          this dashboard.

                        </p>

                      </div>

                      {/* PLUS BUTTON */}

                      <button
                        type="button"
                        onClick={
                          addWorksheetRow
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-moss-600 text-white shadow-md shadow-moss-600/20 transition hover:bg-moss-700 active:scale-95"
                        title="Add another worksheet"
                      >

                        <Plus size={20} />

                      </button>

                    </div>

                    <div className="space-y-3">

                      {worksheetForm.worksheets.map(
                        (
                          worksheet,
                          index
                        ) => (
                          <div
                            key={
                              index
                            }
                            className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
                          >

                            <div className="mb-3 flex items-center justify-between">

                              <p className="text-[10px] font-black uppercase tracking-widest text-moss-600">

                                Worksheet{" "}
                                {index +
                                  1}

                              </p>

                              {worksheetForm
                                .worksheets
                                .length >
                                1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeWorksheetRow(
                                      index
                                    )
                                  }
                                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                                  title="Remove worksheet"
                                >

                                  <Trash2
                                    size={
                                      15
                                    }
                                  />

                                </button>
                              )}

                            </div>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">

                              {/* NAME */}

                              <div>

                                <label className="mb-1.5 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-400">

                                  <Sheet
                                    size={
                                      11
                                    }
                                    className="text-moss-600"
                                  />

                                  Page /
                                  Sheet
                                  Name

                                </label>

                                <input
                                  type="text"
                                  required
                                  value={
                                    worksheet.worksheetName
                                  }
                                  onChange={(
                                    e
                                  ) =>
                                    updateWorksheetRow(
                                      index,
                                      "worksheetName",
                                      e
                                        .target
                                        .value
                                    )
                                  }
                                  placeholder="e.g. Farmer_Details"
                                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none transition placeholder:font-medium placeholder:text-slate-300 focus:border-moss-600 focus:ring-4 focus:ring-moss-600/10"
                                />

                              </div>

                              {/* GID */}

                              <div>

                                <label className="mb-1.5 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-400">

                                  <Hash
                                    size={
                                      11
                                    }
                                    className="text-moss-600"
                                  />

                                  GID

                                </label>

                                <input
                                  type="text"
                                  required
                                  inputMode="numeric"
                                  value={
                                    worksheet.gid
                                  }
                                  onChange={(
                                    e
                                  ) =>
                                    updateWorksheetRow(
                                      index,
                                      "gid",
                                      e
                                        .target
                                        .value
                                    )
                                  }
                                  placeholder="e.g. 0"
                                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none transition placeholder:font-medium placeholder:text-slate-300 focus:border-moss-600 focus:ring-4 focus:ring-moss-600/10"
                                />

                              </div>

                            </div>

                          </div>
                        )
                      )}

                    </div>

                  </div>

                  {/* ERROR */}

                  {worksheetError && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-bold text-red-600">

                      <AlertCircle
                        size={16}
                        className="mt-0.5 shrink-0"
                      />

                      {
                        worksheetError
                      }

                    </div>
                  )}

                </div>

                {/* ACTIONS */}

                <div className="sticky bottom-0 mt-7 flex gap-4 border-t border-slate-100 bg-white pt-5">

                  <button
                    type="button"
                    onClick={
                      closeWorksheetModal
                    }
                    disabled={
                      worksheetSaving
                    }
                    className="flex-1 rounded-2xl bg-slate-50 py-4 text-[11px] font-black uppercase tracking-widest text-slate-400 transition hover:bg-slate-100 disabled:cursor-not-allowed"
                  >

                    Cancel

                  </button>

                  <button
                    type="submit"
                    disabled={
                      worksheetSaving
                    }
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-moss-600 py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-moss-600/20 transition hover:bg-moss-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >

                    {worksheetSaving
                      ? "Saving..."
                      : "Save Worksheets"}

                  </button>

                </div>

              </form>

            </div>

          </div>
        )}

        {/* ===================================================
            CONFIRM MODAL
        =================================================== */}

        {showConfirmModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">

            <div
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              onClick={() =>
                setShowConfirmModal(
                  false
                )
              }
            />

            <div className="relative w-full max-w-sm rounded-[2rem] border border-white/20 bg-white p-8 text-center shadow-2xl">

              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-moss-50">

                <FileText className="h-8 w-8 text-moss-600" />

              </div>

              <h3 className="mb-2 text-xl font-black text-slate-900">

                {
                  confirmConfig.title
                }

              </h3>

              <p className="mb-8 px-2 text-sm leading-relaxed text-slate-500">

                {
                  confirmConfig.message
                }

              </p>

              <div className="flex gap-4">

                <button
                  onClick={() =>
                    setShowConfirmModal(
                      false
                    )
                  }
                  className="flex-1 rounded-xl bg-slate-100 py-3.5 text-sm font-bold text-slate-600 transition-all hover:bg-slate-200"
                >

                  Cancel

                </button>

                <button
                  onClick={
                    confirmConfig.action
                  }
                  className="flex-1 rounded-xl bg-moss-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-moss-600/20 transition-all hover:bg-moss-700 active:scale-95"
                >

                  Confirm

                </button>

              </div>

            </div>

          </div>
        )}

        {/* ===================================================
            PREVIEW
        =================================================== */}

        {previewId && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8">

            <div
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              onClick={() =>
                setPreviewId(null)
              }
            />

            <div className="relative flex h-full max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2.5rem] border border-white/20 bg-white shadow-2xl">

              <div className="flex items-center justify-between border-b border-slate-100 bg-white px-8 py-4">

                <div className="flex items-center gap-3">

                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-moss-50">

                    <FileBarChart className="h-5 w-5 text-moss-600" />

                  </div>

                  <div>

                    <p className="mb-1 text-[10px] font-black uppercase leading-none tracking-widest text-slate-400">

                      Live Preview

                    </p>

                    <p className="text-sm font-black leading-none text-slate-900">

                      Power BI Dashboard

                    </p>

                  </div>

                </div>

                <button
                  onClick={() =>
                    setPreviewId(null)
                  }
                  className="rounded-xl border border-slate-100 bg-slate-50 px-6 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-400 shadow-sm transition-all hover:bg-slate-100"
                >

                  Close Preview

                </button>

              </div>

              <div className="relative flex-grow bg-slate-100">

                <iframe
                  title="Power BI Preview"
                  className="h-full w-full"
                  src={getFullPowerBiUrl(
                    previewId
                  )}
                  frameBorder="0"
                  allowFullScreen
                />

              </div>

            </div>

          </div>
        )}

        {/* ===================================================
            DETAILS
        =================================================== */}

        {viewingReport && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">

            <div
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              onClick={() =>
                setViewingReport(
                  null
                )
              }
            />

            <div className="relative w-full max-w-md rounded-[2.5rem] border border-white/20 bg-white p-8 shadow-2xl">

              <div className="mb-6 flex items-start justify-between">

                <div className="flex items-center gap-4">

                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-moss-50">

                    <FileText className="h-7 w-7 text-moss-600" />

                  </div>

                  <div>

                    <h3 className="mb-1 text-xl font-black leading-tight text-slate-800">

                      {
                        viewingReport.title
                      }

                    </h3>

                    <span className="rounded border border-slate-100 bg-slate-50 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-slate-400 shadow-sm">

                      {new Date(
                        viewingReport.createdAt
                      ).toLocaleDateString()}

                    </span>

                  </div>

                </div>

              </div>

              <div className="mb-8 rounded-3xl border border-slate-100 bg-slate-50/50 p-6">

                <p className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400">

                  <Layout
                    size={12}
                    className="text-moss-600"
                  />

                  Full Description

                </p>

                <div className="whitespace-pre-wrap text-[12px] font-bold leading-relaxed text-slate-600">

                  {viewingReport.description ||
                    "No description provided."}

                </div>

              </div>

              <div className="flex gap-4">

                <button
                  onClick={() =>
                    setViewingReport(
                      null
                    )
                  }
                  className="flex-1 rounded-2xl bg-slate-50 py-4 text-[11px] font-black uppercase tracking-widest text-slate-400 transition-all hover:bg-slate-100"
                >

                  Close Details

                </button>

                <button
                  onClick={() => {
                    setPreviewId(
                      viewingReport.reportId
                    );

                    setViewingReport(
                      null
                    );
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-moss-600 py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-moss-600/20 transition-all hover:bg-moss-700"
                >

                  <ExternalLink
                    size={14}
                  />

                  Launch Report

                </button>

              </div>

            </div>

          </div>
        )}

      </div>
    </ManagementLayout>
  );
}

export default StaffDashboard;