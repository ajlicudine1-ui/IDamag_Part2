import React, { useEffect, useState } from "react";
import {
  MessageSquareText,
  LayoutDashboard,
  Globe2,
  RefreshCw,
  User,
  Mail,
  CalendarDays,
  Star,
} from "lucide-react";

import ManagementLayout from "../../components/management/ManagementLayout";

function FeedbackManagement() {
  const [activeTab, setActiveTab] = useState("dashboard");

  const [dashboardFeedback, setDashboardFeedback] = useState([]);
  const [websiteFeedback, setWebsiteFeedback] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const RAW_API_URL = (
    import.meta.env.VITE_API_URL ||
    "http://localhost:5000/api"
  ).replace(/\/+$/, "");

  const API_URL = RAW_API_URL.endsWith("/api")
    ? RAW_API_URL
    : `${RAW_API_URL}/api`;

  const loadFeedback = async () => {
    try {
      setLoading(true);
      setError("");

      const [dashboardResponse, websiteResponse] =
        await Promise.all([
          fetch(`${API_URL}/feedback/dashboard`),
          fetch(`${API_URL}/feedback/website`),
        ]);

      if (!dashboardResponse.ok) {
        throw new Error(
          "Unable to load dashboard feedback."
        );
      }

      if (!websiteResponse.ok) {
        throw new Error(
          "Unable to load website feedback."
        );
      }

      const dashboardData =
        await dashboardResponse.json();

      const websiteData =
        await websiteResponse.json();

      setDashboardFeedback(
        Array.isArray(dashboardData)
          ? dashboardData
          : []
      );

      setWebsiteFeedback(
        Array.isArray(websiteData)
          ? websiteData
          : []
      );
    } catch (err) {
      console.error("Feedback loading error:", err);

      setError(
        err.message ||
          "Unable to load feedback records."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeedback();
  }, []);

  const formatDate = (date) => {
    if (!date) return "—";

    return new Date(date).toLocaleString(
      "en-PH",
      {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }
    );
  };

  const renderRating = (value) => {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "—";
    }

    return (
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50">
          <Star
            size={15}
            className="text-amber-500"
            fill="currentColor"
          />
        </div>

        <span className="font-black text-slate-700">
          {value}
        </span>

        <span className="text-xs font-semibold text-slate-400">
          / 5
        </span>
      </div>
    );
  };

  return (
    <ManagementLayout title="Manage Feedbacks">
      <div className="space-y-8 animate-in fade-in duration-500">

        {/* HEADER */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-moss-50">
                <MessageSquareText className="h-6 w-6 text-moss-600" />
              </div>

              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900">
                  Feedback Management
                </h1>

                <p className="text-sm font-medium text-slate-400">
                  Review feedback submitted by
                  I-DAMAG users.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={loadFeedback}
            disabled={loading}
            className="
              inline-flex items-center justify-center
              gap-2 rounded-2xl
              bg-moss-600
              px-5 py-3
              text-xs font-black uppercase
              tracking-widest text-white
              shadow-lg shadow-moss-600/20
              transition-all
              hover:bg-moss-700
              active:scale-95
              disabled:cursor-not-allowed
              disabled:bg-slate-300
            "
          >
            <RefreshCw
              size={16}
              className={
                loading ? "animate-spin" : ""
              }
            />

            Refresh
          </button>
        </div>

        {/* SUMMARY */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">

          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              Total Feedback
            </p>

            <p className="text-3xl font-black text-slate-900">
              {dashboardFeedback.length +
                websiteFeedback.length}
            </p>
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <LayoutDashboard
                size={14}
                className="text-moss-600"
              />

              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Dashboard Feedback
              </p>
            </div>

            <p className="text-3xl font-black text-slate-900">
              {dashboardFeedback.length}
            </p>
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <Globe2
                size={14}
                className="text-moss-600"
              />

              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Website Feedback
              </p>
            </div>

            <p className="text-3xl font-black text-slate-900">
              {websiteFeedback.length}
            </p>
          </div>
        </div>

        {/* FEEDBACK TABLE */}
        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">

          {/* TABS */}
          <div className="flex border-b border-slate-100 bg-slate-50/40 px-6 pt-4">

            <button
              type="button"
              onClick={() =>
                setActiveTab("dashboard")
              }
              className={`
                flex items-center gap-2
                border-b-2
                px-5 py-4
                text-xs font-black
                uppercase tracking-widest
                transition-all

                ${
                  activeTab === "dashboard"
                    ? "border-moss-600 text-moss-700"
                    : "border-transparent text-slate-400 hover:text-slate-700"
                }
              `}
            >
              <LayoutDashboard size={16} />

              Dashboard Feedback

              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">
                {dashboardFeedback.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                setActiveTab("website")
              }
              className={`
                flex items-center gap-2
                border-b-2
                px-5 py-4
                text-xs font-black
                uppercase tracking-widest
                transition-all

                ${
                  activeTab === "website"
                    ? "border-moss-600 text-moss-700"
                    : "border-transparent text-slate-400 hover:text-slate-700"
                }
              `}
            >
              <Globe2 size={16} />

              Website Feedback

              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">
                {websiteFeedback.length}
              </span>
            </button>
          </div>

          {error && (
            <div className="m-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex min-h-[300px] items-center justify-center">
              <div className="flex items-center gap-3 text-sm font-bold text-slate-400">
                <RefreshCw
                  size={18}
                  className="animate-spin"
                />

                Loading feedback...
              </div>
            </div>
          ) : (
            <>
              {activeTab === "dashboard" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50/70">

                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          User
                        </th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          User Interface
                        </th>

                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          User Experience
                        </th>

                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Data Completeness
                        </th>

                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Data Accuracy
                        </th>

                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Accessibility
                        </th>

                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Comments
                        </th>

                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Submitted
                        </th>

                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">

                      {dashboardFeedback.length ===
                      0 ? (
                        <tr>
                          <td
                            colSpan="8"
                            className="px-6 py-16 text-center text-sm font-bold text-slate-400"
                          >
                            No dashboard feedback
                            found.
                          </td>
                        </tr>
                      ) : (
                        dashboardFeedback.map(
                          (feedback, index) => (
                            <tr
                              key={`${feedback.email}-${feedback.createdAt ?? feedback.created_at}-${index}`}
                              className="transition-colors hover:bg-slate-50/50"
                            >

                              <td className="px-6 py-5">
                                <div className="flex items-start gap-3">

                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-moss-50">
                                    <User
                                      size={16}
                                      className="text-moss-600"
                                    />
                                  </div>

                                  <div>
                                    <p className="font-black text-slate-800">
                                      {feedback.full_name ||
                                        "Anonymous"}
                                    </p>

                                    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-400">
                                      <Mail size={11} />

                                      {feedback.email ||
                                        "No email"}
                                    </p>
                                  </div>

                                </div>
                              </td>

                              <td className="px-6 py-5">
                                {renderRating(
                                  feedback.userInterface ??
                                    feedback.user_interface
                                )}
                              </td>

                              <td className="px-6 py-5">
                                {renderRating(
                                  feedback.userExperience ??
                                    feedback.user_experience
                                )}
                              </td>

                              <td className="px-6 py-5">
                                {renderRating(
                                  feedback.dataCompleteness ??
                                    feedback.data_completeness
                                )}
                              </td>

                              <td className="px-6 py-5">
                                {renderRating(
                                  feedback.data_accuracy
                                )}
                              </td>

                              <td className="px-6 py-5">
                                {renderRating(
                                  feedback.accessibility
                                )}
                              </td>

                              <td className="max-w-sm px-6 py-5">
                                <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-600">
                                  {feedback.additional_comments ||
                                    "No additional comments"}
                                </p>
                              </td>

                              <td className="whitespace-nowrap px-6 py-5">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                                  <CalendarDays
                                    size={14}
                                    className="text-slate-300"
                                  />

                                  {formatDate(
                                    feedback.created_at
                                  )}
                                </div>
                              </td>

                            </tr>
                          )
                        )
                      )}

                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === "website" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">

                    <thead>
                      <tr className="bg-slate-50/70">

                        <th className="w-24 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          ID
                        </th>

                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Website Suggestion
                        </th>

                        <th className="w-64 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Submitted
                        </th>

                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">

                      {websiteFeedback.length ===
                      0 ? (
                        <tr>
                          <td
                            colSpan="3"
                            className="px-6 py-16 text-center text-sm font-bold text-slate-400"
                          >
                            No website feedback
                            found.
                          </td>
                        </tr>
                      ) : (
                        websiteFeedback.map(
                          (feedback) => (
                            <tr
                              key={feedback.id}
                              className="transition-colors hover:bg-slate-50/50"
                            >

                              <td className="px-6 py-5">
                                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-500">
                                  #{feedback.id}
                                </span>
                              </td>

                              <td className="px-6 py-5">
                                <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-600">
                                  {feedback.website_suggestion ||
                                    "No suggestion provided"}
                                </p>
                              </td>

                              <td className="whitespace-nowrap px-6 py-5">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500">

                                  <CalendarDays
                                    size={14}
                                    className="text-slate-300"
                                  />

                                  {formatDate(
                                    feedback.created_at
                                  )}

                                </div>
                              </td>

                            </tr>
                          )
                        )
                      )}

                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ManagementLayout>
  );
}

export default FeedbackManagement;