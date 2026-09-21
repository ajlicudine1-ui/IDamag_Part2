import logo from "../../assets/DA-RFO1_LOGO.png";

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Star, Send, CheckCircle2 } from "lucide-react";
import Footer from "./Footer";


const FORM_ACTION_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfWsUQEep8NK39vhUnIdxUT1MkGUI7NMi-17t2O96tEpcToIg/formResponse";

const ENTRY_IDS = {
  name: "entry.911567496",
  email: "entry.1974072567",
  dashboardName: "entry.1547865169",
  ui: "entry.2145959113",
  ux: "entry.1243671929",
  completeness: "entry.181596178",
  accuracy: "entry.1601095705",
  accessibility: "entry.1847836371",
  comments: "entry.470097147",
};

const CRITERIA = [
  { key: "ui", label: "User Interface", hint: "Layout, visual design, clarity" },
  { key: "ux", label: "User Experience", hint: "Ease of navigation and use" },
  { key: "completeness", label: "Data Completeness", hint: "Is information missing or thorough?" },
  { key: "accuracy", label: "Data Accuracy", hint: "Correctness of the figures shown" },
  { key: "accessibility", label: "Accessibility", hint: "Easy to reach for all stakeholders" },
];

const StarRating = ({ value, onChange }) => (
  <div className="flex items-center gap-1.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <button
        key={n}
        type="button"
        onClick={() => onChange(n)}
        aria-label={`Rate ${n} out of 5`}
        className="p-1 -m-1 rounded-lg transition-transform active:scale-90"
      >
        <Star
          className={`w-6 h-6 transition-colors ${
            n <= value
              ? "fill-yellow-400 text-yellow-400"
              : "fill-transparent text-slate-300"
          }`}
        />
      </button>
    ))}
  </div>
);

const Feedback = () => {
  const [ratings, setRatings] = useState(
    Object.fromEntries(CRITERIA.map((c) => [c.key, 0]))
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dashboardName, setDashboardName] = useState("");
  const [comments, setComments] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const setRating = (key, value) =>
    setRatings((prev) => ({ ...prev, [key]: value }));

  const allRated = CRITERIA.every((c) => ratings[c.key] > 0);
  const canSubmit = allRated && dashboardName.trim().length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);

    const formData = new FormData();
    formData.append(ENTRY_IDS.name, name);
    formData.append(ENTRY_IDS.email, email);
    formData.append(ENTRY_IDS.dashboardName, dashboardName);
    CRITERIA.forEach((c) => {
      formData.append(ENTRY_IDS[c.key], String(ratings[c.key]));
    });
    formData.append(ENTRY_IDS.comments, comments);

    try {
      await fetch(FORM_ACTION_URL, {
        method: "POST",
        mode: "no-cors",
        body: formData,
      });
      setSubmitted(true);
    } catch (err) {
      console.error("Submission failed:", err);
      alert("Something went wrong submitting your feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      <main className="flex-1 pt-6 pb-12 px-4 md:px-8">
        <div className="w-full max-w-7xl mx-auto">

          {/* Header */}
            <div className="relative mb-8">

              {/* Back to Home - KEEP THIS */}
              <Link
                to="/"
                className="absolute left-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-2 text-slate-500 hover:text-green-700 text-sm font-semibold transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="hidden sm:inline">Back to Home</span>
              </Link>

              {/* Logo + Title */}
              <div className="flex items-center justify-center gap-2 sm:gap-4 px-10 sm:px-0">
                <img
                  src={logo}
                  alt="Department of Agriculture Logo"
                  className="w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 object-contain"
                />

                <h1 className="text-xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 text-center leading-tight">
                  I-DAMAG FEEDBACK FORM
                </h1>
              </div>

            </div>

          {/* Description */}
          <p className="text-center text-sm sm:text-base md:text-lg text-slate-600 max-w-3xl mx-auto mb-8 px-2">
            Share your comments and suggestions to help us improve the{" "}
            <span className="font-semibold text-green-700">Ilocos DAMAG</span>{" "}
            system.
          </p>

          {/* Form */}
          <div className="max-w-2xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="h-1.5 w-full bg-green-700" />

            {submitted ? (
              <div className="flex flex-col items-center text-center px-8 py-16">
                <CheckCircle2 className="w-14 h-14 text-green-700 mb-4" />
                <h2 className="text-2xl font-bold text-slate-800 mb-2">
                  Thank you for your feedback
                </h2>
                <p className="text-slate-600 max-w-sm">
                  Your response has been recorded and will help us improve the
                  i-DAMAG dashboard for every stakeholder.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="px-6 py-8 md:px-10 md:py-10">

                {/* Dashboard Name — required */}
                <div className="mb-8">
                  <label className="block font-semibold text-slate-800 text-sm mb-2">
                    Dashboard Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={dashboardName}
                    onChange={(e) => setDashboardName(e.target.value)}
                    placeholder="e.g. Crop Production, Livestock, Market Prices"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-600/40 focus:border-green-600 transition-shadow"
                  />
                </div>

                {/* Ratings */}
                <div className="space-y-6 mb-8">
                  {CRITERIA.map((c) => (
                    <div
                      key={c.key}
                      className="flex items-center justify-between gap-4 pb-5 border-b border-slate-200 last:border-0 last:pb-0"
                    >
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">
                          {c.label}
                        </p>
                        <p className="text-xs text-slate-500">{c.hint}</p>
                      </div>
                      <StarRating
                        value={ratings[c.key]}
                        onChange={(v) => setRating(c.key, v)}
                      />
                    </div>
                  ))}
                </div>

                {/* Comments */}
                <div className="mb-6">
                  <label className="block font-semibold text-slate-800 text-sm mb-2">
                    Additional comments
                  </label>
                  <textarea
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    rows={4}
                    placeholder="What would make this dashboard more useful to you?"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-600/40 focus:border-green-600 transition-shadow resize-none"
                  />
                </div>

                {/* Name / Email — optional */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  <div>
                    <label className="block font-semibold text-slate-800 text-sm mb-2">
                      Full name <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-600/40 focus:border-green-600 transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-800 text-sm mb-2">
                      Email <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-600/40 focus:border-green-600 transition-shadow"
                    />
                  </div>
                </div>

                {/* Privacy Notice */}
                <details className="mb-8 group">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-green-700 select-none">
                    Privacy Notice
                  </summary>
                  <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                    Information collected is used solely to evaluate and
                    improve the i-DAMAG Dashboard. Your name and email are
                    optional and used only for feedback-related
                    communication, processed under the Data Privacy Act of
                    2012 (RA 10173). Responses are kept confidential and
                    accessed only by authorized personnel.
                  </p>
                </details>

                <button
                  type="submit"
                  disabled={!canSubmit || submitting}
                  className="w-full flex items-center justify-center gap-2 bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl py-3.5 transition-all hover:bg-green-800 active:scale-[0.98]"
                >
                  <Send className="w-4 h-4" />
                  {submitting ? "Submitting..." : "Submit Feedback"}
                </button>
                {!canSubmit && (
                  <p className="text-center text-xs text-slate-400 mt-3">
                    Please enter a dashboard name and rate all five categories to submit.
                  </p>
                )}
              </form>
            )}
          </div>

        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Feedback;