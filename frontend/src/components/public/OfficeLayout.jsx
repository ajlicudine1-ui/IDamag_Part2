import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import Footer from "./Footer";
import { getOfficeById } from "../../constants/offices";
import { getDivisions, getReports } from "../../services/api";
import {
  ChevronRight,
  FileBarChart,
  Layers,
  ArrowLeft,
  Menu,
  Wheat,
  Sprout,
  Users,
  HeartPulse,
  Banknote,
  Construction,
  FlaskConical,
  Settings,
  LayoutGrid,
} from "lucide-react";


const getCategoryIcon = (office) => {
  const acronym = String(office?.acronym || "")
    .trim()
    .toUpperCase();

  const name = String(office?.name || "")
    .trim()
    .toLowerCase();

  const iconByAcronym = {
    AGPROD: Wheat,
    AGPROG: Sprout,
    ADMIN: Settings,
    "FARM&BEN": Users,
    AH: HeartPulse,
    FINMAN: Banknote,
    INFRA: Construction,
    "R&T": FlaskConical,
    OTHERS: LayoutGrid,
  };

  if (iconByAcronym[acronym]) {
    return iconByAcronym[acronym];
  }

  if (name.includes("agricultural production")) return Wheat;
  if (name.includes("agricultural programs")) return Sprout;
  if (name.includes("administration")) return Settings;
  if (
    name.includes("farmers") ||
    name.includes("beneficiaries")
  ) {
    return Users;
  }
  if (name.includes("animal health")) return HeartPulse;
  if (name.includes("financial management")) return Banknote;
  if (name.includes("infrastructure")) return Construction;
  if (
    name.includes("research") ||
    name.includes("technical services")
  ) {
    return FlaskConical;
  }

  return LayoutGrid;
};

function OfficeLayout() {
  const { officeId } = useParams();

  const [office, setOffice] = useState(null);
  const [officeLoading, setOfficeLoading] = useState(true);
  const [officeError, setOfficeError] = useState("");

  const [divisions, setDivisions] = useState([]);
  const [selectedDivision, setSelectedDivision] = useState(null);

  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isManualCollapsed, setIsManualCollapsed] =
    useState(false);

  const [viewingReport, setViewingReport] = useState(null);

  // Load the selected office/category from the database
  useEffect(() => {
    let isMounted = true;

    const loadOffice = async () => {
      try {
        setOfficeLoading(true);
        setOfficeError("");
        setOffice(null);

        const officeData = await getOfficeById(officeId);

        if (!isMounted) return;

        if (!officeData) {
          setOfficeError("Office not found.");
          return;
        }

        setOffice(officeData);
      } catch (error) {
        if (!isMounted) return;

        console.error("Error loading office:", error);

        setOfficeError(
          error.message || "Unable to load office."
        );
      } finally {
        if (isMounted) {
          setOfficeLoading(false);
        }
      }
    };

    if (officeId) {
      loadOffice();
    } else {
      setOfficeError("A valid office ID is required.");
      setOfficeLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [officeId]);

  // Load divisions when the office changes
  useEffect(() => {
    let isMounted = true;

    const loadDivisions = async () => {
      try {
        setSelectedDivision(null);
        setSelectedReport(null);
        setViewingReport(null);
        setDivisions([]);
        setReports([]);
        setIsSidebarOpen(false);
        setIsLoading(true);

        if (!officeId) {
          return;
        }

        const response = await getDivisions(officeId);

        if (!isMounted) return;

        const divisionData = Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response)
            ? response
            : [];

        setDivisions(divisionData);
      } catch (error) {
        if (!isMounted) return;

        console.error(
          "Error fetching divisions:",
          error
        );

        setDivisions([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadDivisions();

    return () => {
      isMounted = false;
    };
  }, [officeId]);

  // Load reports when the selected division changes
  useEffect(() => {
    let isMounted = true;

    const loadReports = async () => {
      if (!selectedDivision) {
        setReports([]);
        setSelectedReport(null);
        return;
      }

      try {
        setIsLoading(true);
        setSelectedReport(null);
        setViewingReport(null);

        const response = await getReports({
          divisionId: selectedDivision.id,
        });

        if (!isMounted) return;

        const reportData = Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response)
            ? response
            : [];

        setReports(reportData);
      } catch (error) {
        if (!isMounted) return;

        console.error("Error fetching reports:", error);
        setReports([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadReports();

    return () => {
      isMounted = false;
    };
  }, [selectedDivision]);

  if (officeLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-moss-600" />

          <p className="mt-4 text-lg text-slate-500">
            Loading category...
          </p>
        </div>
      </div>
    );
  }

  if (officeError || !office) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
        <p className="text-2xl font-bold text-slate-700">
          {officeError || "Office not found."}
        </p>

        <Link
          to="/"
          className="font-semibold text-moss-600 hover:underline"
        >
          Go Home
        </Link>
      </div>
    );
  }

  const CategoryIcon = getCategoryIcon(office);

  return (
    <div className="h-screen w-full overflow-hidden flex flex-col">
      <Header />

      <div className="flex flex-grow overflow-hidden relative">
        {/* Sidebar */}
        <Sidebar
          activeOfficeId={office.id}
          isCollapsed={
            Boolean(selectedReport) || isManualCollapsed
          }
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          isManualCollapsed={isManualCollapsed}
          setIsManualCollapsed={setIsManualCollapsed}
          divisions={divisions}
          selectedDivision={selectedDivision}
          setSelectedDivision={setSelectedDivision}
        />

        <main className="flex-grow overflow-y-auto bg-slate-50 relative h-full">
          {/* Sticky category header */}
          {!selectedReport && (
            <div className="sticky top-0 z-20 bg-slate-50/80 backdrop-blur-md px-6 lg:px-12 py-4 lg:py-6 border-b border-slate-200/60 flex items-center justify-between">
              <div className="flex items-center gap-3 lg:gap-4">
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  className="md:hidden p-2 bg-white rounded-xl shadow-sm border border-slate-200 text-slate-600 active:scale-95 transition-all mr-1"
                  aria-label="Open sidebar"
                >
                  <Menu className="w-5 h-5" />
                </button>

                <div className="w-9 h-9 lg:w-10 lg:h-10 bg-moss-50 rounded-lg lg:rounded-xl flex items-center justify-center text-moss-600 shadow-sm border border-moss-100">
                  <CategoryIcon className="w-5 h-5 lg:w-6 lg:h-6" />
                </div>

                <div className="hidden sm:flex min-w-[2.2rem] lg:min-w-[2.5rem] h-7 lg:h-8 px-2 lg:px-3 bg-moss-600 rounded-lg items-center justify-center text-white font-bold text-[9px] lg:text-[10px] shadow-lg shadow-moss-600/20">
                  {office.acronym || "N/A"}
                </div>

                <div>
                  <h1 className="text-lg lg:text-xl font-bold text-slate-800 line-clamp-1">
                    {office.name}
                  </h1>
                </div>
              </div>
            </div>
          )}

          {/* Exit report view */}
          {selectedReport && (
            <button
              type="button"
              onClick={() => setSelectedReport(null)}
              className="fixed top-6 right-6 lg:right-8 z-50 flex items-center gap-2 px-4 py-2 lg:px-5 lg:py-2.5 bg-white/90 backdrop-blur shadow-xl border border-slate-200 text-slate-600 hover:text-moss-600 hover:bg-white rounded-full transition-all text-xs font-bold animate-in fade-in zoom-in duration-300"
            >
              <ArrowLeft className="h-4 w-4" />
              Exit Full Screen
            </button>
          )}

          <div
            className={
              selectedReport
                ? "h-full w-full"
                : "p-6 lg:p-12 max-w-7xl mx-auto"
            }
          >
            {!selectedReport ? (
              <div className="animate-in fade-in duration-500">
                {!selectedDivision && (
                  <div className="mt-12 py-20 text-center bg-white rounded-2xl lg:rounded-[2rem] border border-dashed border-slate-200 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="w-16 h-16 bg-moss-50 rounded-full flex items-center justify-center mx-auto mb-6">
                      <Layers className="text-moss-600 w-8 h-8" />
                    </div>

                    <h3 className="text-xl font-bold text-slate-800 mb-2">
                      Select a Section
                    </h3>

                    <p className="text-slate-500">
                      Please choose a section from the sidebar
                      to view its available reports.
                    </p>

                    {!isLoading &&
                      divisions.length === 0 && (
                        <p className="mt-4 text-sm text-slate-400">
                          No sections are available for this
                          category.
                        </p>
                      )}
                  </div>
                )}

                {selectedDivision && (
                  <div className="animate-in slide-in-from-right-8 duration-500">
                    <div className="flex items-center gap-3 lg:gap-4 mb-8 lg:mb-10">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDivision(null)
                        }
                        className="p-2.5 lg:p-3 bg-white border border-slate-100 rounded-xl text-slate-400 hover:text-moss-600 hover:shadow-md transition-all"
                        aria-label="Return to section selection"
                      >
                        <ArrowLeft className="w-5 h-5" />
                      </button>

                      <div>
                        <h2 className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight leading-tight">
                          {selectedDivision.name}
                        </h2>

                        <p className="text-slate-400 text-[10px] lg:text-xs font-bold uppercase tracking-widest">
                          Select a report to view
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
                      {isLoading ? (
                        Array.from({ length: 4 }).map(
                          (_, index) => (
                            <div
                              key={index}
                              className="h-24 lg:h-32 bg-slate-100 animate-pulse rounded-2xl lg:rounded-3xl"
                            />
                          )
                        )
                      ) : reports.length > 0 ? (
                        reports.map((report) => (
                          <div
                            key={report.id}
                            role="button"
                            tabIndex={0}
                            className="bg-white p-6 lg:p-8 rounded-2xl lg:rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all group cursor-pointer flex items-center gap-4 lg:gap-6 relative overflow-hidden"
                            onClick={() =>
                              setSelectedReport(report)
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" ||
                                event.key === " "
                              ) {
                                setSelectedReport(report);
                              }
                            }}
                          >
                            <div className="w-12 h-12 lg:w-16 lg:h-16 bg-moss-50 rounded-xl lg:rounded-2xl flex items-center justify-center group-hover:bg-moss-100 transition-colors flex-shrink-0">
                              <FileBarChart className="text-moss-600 w-6 h-6 lg:w-8 lg:h-8" />
                            </div>

                            <div className="flex-grow">
                              <h3 className="text-base lg:text-lg font-bold text-slate-800 leading-tight mb-1">
                                {report.title}
                              </h3>

                              <div className="relative">
                                <p className="text-slate-400 text-[10px] lg:text-xs leading-relaxed line-clamp-1 opacity-70">
                                  {report.description ||
                                    "Interactive Power BI Dashboard"}
                                </p>

                                {report.description &&
                                  report.description.length >
                                    50 && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setViewingReport(
                                          report
                                        );
                                      }}
                                      className="mt-2 text-moss-600 hover:text-moss-700 font-black text-[9px] lg:text-[10px] uppercase tracking-widest flex items-center gap-1.5 transition-all group/btn"
                                    >
                                      <span className="bg-moss-50 px-2.5 py-1 rounded-md group-hover/btn:bg-moss-100 transition-colors">
                                        Read More
                                      </span>

                                      <ChevronRight
                                        size={12}
                                        className="rotate-90"
                                      />
                                    </button>
                                  )}
                              </div>
                            </div>

                            <div className="flex-shrink-0">
                              <ChevronRight className="text-slate-300 group-hover:text-moss-600 w-5 h-5 lg:w-6 lg:h-6 transition-colors" />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="col-span-full py-16 lg:py-20 text-center bg-white rounded-2xl lg:rounded-[2rem] border border-dashed border-slate-200">
                          <p className="text-slate-400 font-medium">
                            No reports published for this
                            division yet.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="animate-in fade-in zoom-in-95 duration-500 h-full w-full">
                <iframe
                  title={selectedReport.title}
                  width="100%"
                  height="100%"
                  src={`https://app.powerbi.com/view?r=${selectedReport.reportId}`}
                  frameBorder="0"
                  allowFullScreen
                  className="w-full h-full block border-none rounded-none shadow-2xl"
                />
              </div>
            )}
          </div>

          {!selectedReport && <Footer />}

          {/* Report details modal */}
          {viewingReport && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <button
                type="button"
                aria-label="Close report details"
                className="absolute inset-0 w-full h-full bg-slate-900/60 backdrop-blur-md"
                onClick={() => setViewingReport(null)}
              />

              <div className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-8 animate-in zoom-in-95 duration-300 border border-white/20">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-moss-50 rounded-2xl flex items-center justify-center">
                      <FileBarChart className="text-moss-600 w-7 h-7" />
                    </div>

                    <div>
                      <h3 className="text-xl font-black text-slate-800 leading-tight mb-1">
                        {viewingReport.title}
                      </h3>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-0.5 rounded border border-slate-100 shadow-sm">
                          {viewingReport.createdAt
                            ? new Date(
                                viewingReport.createdAt
                              ).toLocaleDateString()
                            : "No date"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50/50 rounded-3xl p-6 border border-slate-100 mb-8">
                  <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Layers
                      size={12}
                      className="text-moss-600"
                    />
                    Full Description
                  </p>

                  <div className="text-[12px] font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {viewingReport.description ||
                      "No description provided."}
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() =>
                      setViewingReport(null)
                    }
                    className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-400 font-black py-4 rounded-2xl transition-all text-[11px] uppercase tracking-widest"
                  >
                    Close Details
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedReport(viewingReport);
                      setViewingReport(null);
                    }}
                    className="flex-1 bg-moss-600 hover:bg-moss-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-moss-600/20 transition-all text-[11px] uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <ChevronRight size={14} />
                    Launch Report
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default OfficeLayout;