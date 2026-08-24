import React, { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";

import Home from "./components/public/Home";
import OfficeLayout from "./components/public/OfficeLayout";
import Feedback from "./components/public/Feedback";
import Chatbot from "./components/public/Chatbot";
import About from "./components/public/About";
import NotFound from "./components/public/NotFound";

import Login from "./pages/admin/Login";
import Register from "./pages/admin/Register";
import StaffDashboard from "./pages/admin/StaffDashboard";
import UserManagement from "./pages/admin/UserManagement";
import OfficeDivisionManagement from "./pages/admin/OfficeDivisionManagement";
import ActivityLog from "./pages/admin/ActivityLog";
import Help from "./pages/Help";

import ProtectedRoute from "./components/auth/ProtectedRoute";
import PublicRoute from "./components/auth/PublicRoute";
import FloatingChatbotButton from "./components/public/FloatingChatbotButton";
import UserGuide from "./components/public/UserGuide";
import FeedbackManagement from "./pages/admin/FeedbackManagement";

/*
 * Supports either:
 *
 * VITE_API_URL=https://i-damag-chatbot-61hx.vercel.app
 *
 * or:
 *
 * VITE_API_URL=https://i-damag-chatbot-61hx.vercel.app/api
 *
 * It always produces one final /api segment.
 */
const RAW_API_URL = (
  import.meta.env.VITE_API_URL ||
  "https://i-damag-chatbot-61hx.vercel.app"
).replace(/\/+$/, "");

const API_URL = RAW_API_URL.endsWith("/api")
  ? RAW_API_URL
  : `${RAW_API_URL}/api`;

async function readJsonResponse(response) {
  const contentType =
    response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const responseText = await response.text();

    console.error(
      "Server returned a non-JSON response:",
      responseText
    );

    throw new Error(
      `The server did not return valid JSON. HTTP ${response.status}.`
    );
  }

  return response.json();
}

function getChatSessionId() {
  let sessionId =
    sessionStorage.getItem(
      "idamag_chat_session"
    );

  if (!sessionId) {
    sessionId =
      crypto.randomUUID();

    sessionStorage.setItem(
      "idamag_chat_session",
      sessionId
    );
  }

  return sessionId;
}

function App() {
  const [isChatbotOpen, setIsChatbotOpen] =
    useState(false);

  // Shared chat-head position so both the draggable button
  // and the chatbot window know where to appear.
  const [chatbotPosition, setChatbotPosition] =
    useState(() => ({
      x:
        typeof window !== "undefined"
          ? Math.max(window.innerWidth - 170, 12)
          : 12,
      y:
        typeof window !== "undefined"
          ? Math.max(window.innerHeight - 170, 12)
          : 12,
    }));

  const [viewportSize, setViewportSize] =
    useState(() => ({
      width:
        typeof window !== "undefined"
          ? window.innerWidth
          : 1280,
      height:
        typeof window !== "undefined"
          ? window.innerHeight
          : 720,
    }));

  // Selection data
  const [divisions, setDivisions] = useState([]);
  const [offices, setOffices] = useState([]);
  const [reports, setReports] = useState([]);

  // Selected items
  const [selectedDivision, setSelectedDivision] =
    useState(null);
  const [selectedOffice, setSelectedOffice] =
    useState(null);
  const [selectedReport, setSelectedReport] =
    useState(null);

  // Selection loading and errors
  const [selectionLoading, setSelectionLoading] =
    useState(false);
  const [selectionError, setSelectionError] =
    useState("");

  // Chat states
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatLoading, setChatLoading] =
    useState(false);

  // Keep the chat head inside the browser window after resize.
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      setViewportSize({
        width,
        height,
      });

      setChatbotPosition((current) => {
        const buttonSize =
          width >= 1024 ? 144 : width >= 640 ? 128 : 112;

        return {
          x: Math.max(
            0,
            Math.min(current.x, width - buttonSize)
          ),
          y: Math.max(
            0,
            Math.min(current.y, height - buttonSize)
          ),
        };
      });
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const resetChatbot = () => {
    setSelectedDivision(null);
    setSelectedOffice(null);
    setSelectedReport(null);

    setOffices([]);
    setReports([]);

    setQuestion("");
    setMessages([]);

    setSelectionError("");
    setChatLoading(false);
  };

  /*
   * Step 1:
   * Load top-level divisions from the offices table.
   */
  useEffect(() => {
    if (!isChatbotOpen || divisions.length > 0) {
      return;
    }

    let isMounted = true;

    const loadDivisions = async () => {
      try {
        setSelectionLoading(true);
        setSelectionError("");

        const response = await fetch(
          `${API_URL}/chatbot/divisions`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          }
        );

        const data = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load divisions."
          );
        }

        const divisionList = Array.isArray(
          data.divisions
        )
          ? data.divisions
          : [];

        const normalizedDivisions =
          divisionList.map((division, index) => ({
            id: Number(division.id),

            code:
              division.code ||
              division.acronym ||
              `division-${index + 1}`,

            acronym:
              division.acronym ||
              division.code ||
              "",

            name:
              division.name ||
              "Unnamed Division",

            description:
              division.description ||
              `Ask questions about ${
                division.name ||
                division.code ||
                "this division"
              } data.`,
          }));

        if (isMounted) {
          setDivisions(normalizedDivisions);
        }
      } catch (error) {
        console.error(
          "Unable to load chatbot divisions:",
          error
        );

        if (isMounted) {
          setDivisions([]);

          setSelectionError(
            error.message ||
              "Unable to connect to the chatbot server."
          );
        }
      } finally {
        if (isMounted) {
          setSelectionLoading(false);
        }
      }
    };

    loadDivisions();

    return () => {
      isMounted = false;
    };
  }, [isChatbotOpen, divisions.length]);

  /*
   * Step 2:
   * Load offices/sections after selecting a division.
   */
  useEffect(() => {
    if (!selectedDivision?.id) {
      return;
    }

    let isMounted = true;

    const loadOffices = async () => {
      try {
        setSelectionLoading(true);
        setSelectionError("");

        setOffices([]);
        setReports([]);

        setSelectedOffice(null);
        setSelectedReport(null);

        const response = await fetch(
          `${API_URL}/chatbot/offices?divisionId=${encodeURIComponent(
            selectedDivision.id
          )}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          }
        );

        const data = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load offices or sections."
          );
        }

        const officeList = Array.isArray(
          data.offices
        )
          ? data.offices
          : [];

        if (isMounted) {
          setOffices(
            officeList.map((office) => ({
              id: Number(office.id),

              code:
                office.code ||
                office.acronym ||
                "",

              acronym:
                office.acronym ||
                office.code ||
                "",

              name:
                office.name ||
                "Unnamed Office or Section",

              divisionId: Number(
                office.divisionId
              ),
            }))
          );
        }
      } catch (error) {
        console.error(
          "Unable to load chatbot offices:",
          error
        );

        if (isMounted) {
          setOffices([]);

          setSelectionError(
            error.message ||
              "Unable to load offices or sections."
          );
        }
      } finally {
        if (isMounted) {
          setSelectionLoading(false);
        }
      }
    };

    loadOffices();

    return () => {
      isMounted = false;
    };
  }, [selectedDivision]);

  /*
   * Step 3:
   * Load reports after selecting an office/section.
   */
  useEffect(() => {
    if (!selectedOffice?.id) {
      return;
    }

    let isMounted = true;

    const loadReports = async () => {
      try {
        setSelectionLoading(true);
        setSelectionError("");

        setReports([]);
        setSelectedReport(null);

        const response = await fetch(
          `${API_URL}/chatbot/reports?officeId=${encodeURIComponent(
            selectedOffice.id
          )}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          }
        );

        const data = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load reports."
          );
        }

        const reportList = Array.isArray(
          data.reports
        )
          ? data.reports
          : [];

        if (isMounted) {
          setReports(
            reportList.map((report) => ({
              id: Number(report.id),

              title:
                report.title ||
                "Untitled Report",

              description:
                report.description || "",

              hasSheet: Boolean(
                report.hasSheet
              ),
            }))
          );
        }
      } catch (error) {
        console.error(
          "Unable to load chatbot reports:",
          error
        );

        if (isMounted) {
          setReports([]);

          setSelectionError(
            error.message ||
              "Unable to load reports."
          );
        }
      } finally {
        if (isMounted) {
          setSelectionLoading(false);
        }
      }
    };

    loadReports();

    return () => {
      isMounted = false;
    };
  }, [selectedOffice]);

  const handleToggleChatbot = () => {
    setIsChatbotOpen((current) => !current);
  };

  const handleCloseChatbot = () => {
    setIsChatbotOpen(false);
    resetChatbot();
  };

  const handleSelectDivision = (division) => {
    setSelectedDivision(division);

    setSelectedOffice(null);
    setSelectedReport(null);

    setOffices([]);
    setReports([]);

    setMessages([]);
    setQuestion("");
    setSelectionError("");
  };

  const handleSelectOffice = (office) => {
    setSelectedOffice(office);

    setSelectedReport(null);
    setReports([]);

    setMessages([]);
    setQuestion("");
    setSelectionError("");
  };

  const handleSelectReport = (report) => {
    setSelectedReport(report);

    setSelectionError("");
    setQuestion("");

    if (!report.hasSheet) {
      setMessages([
        {
          role: "bot",
          text: `"${report.title}" does not have a Google Sheet connected yet.`,
        },
      ]);

      return;
    }

    setMessages([
      {
        role: "bot",
        text: `Hello! You selected "${report.title}". Ask me a question about its connected Google Sheet data.`,
      },
    ]);
  };

  const handleBack = () => {
    if (selectedReport) {
      setSelectedReport(null);
      setMessages([]);
      setQuestion("");
      return;
    }

    if (selectedOffice) {
      setSelectedOffice(null);
      setSelectedReport(null);

      setReports([]);

      setMessages([]);
      setQuestion("");

      return;
    }

    if (selectedDivision) {
      setSelectedDivision(null);
      setSelectedOffice(null);
      setSelectedReport(null);

      setOffices([]);
      setReports([]);

      setMessages([]);
      setQuestion("");
    }
  };

  const handleRetry = () => {
    setSelectionError("");

    if (!selectedDivision) {
      setDivisions([]);
      return;
    }

    if (!selectedOffice) {
      const savedDivision =
        selectedDivision;

      setSelectedDivision(null);

      setTimeout(() => {
        setSelectedDivision(
          savedDivision
        );
      }, 0);

      return;
    }

    const savedOffice =
      selectedOffice;

    setSelectedOffice(null);

    setTimeout(() => {
      setSelectedOffice(
        savedOffice
      );
    }, 0);
  };

  const sendQuestion = async () => {
    const trimmedQuestion =
      question.trim();

    if (
      !trimmedQuestion ||
      chatLoading ||
      !selectedReport?.id ||
      !selectedReport.hasSheet
    ) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        role: "user",
        text: trimmedQuestion,
      },
    ]);

    setQuestion("");
    setChatLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/chatbot/chat`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
            Accept: "application/json",
          },

          body: JSON.stringify({
            question:
              trimmedQuestion,

            reportId: Number(
              selectedReport.id
            ),

            sessionId:
              getChatSessionId(),
          }),
        }
      );

      const data =
        await readJsonResponse(
          response
        );

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to get an answer."
        );
      }

      setMessages((current) => [
        ...current,
        {
          role: "bot",
          text:
            data.answer ||
            "The chatbot did not return an answer.",
        },
      ]);
    } catch (error) {
      console.error(
        "Chatbot question error:",
        error
      );

      setMessages((current) => [
        ...current,
        {
          role: "bot",
          text:
            error.message ||
            "Unable to connect to the chatbot server.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleQuestionKeyDown = (
    event
  ) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      sendQuestion();
    }
  };

  const showBackButton =
    selectedDivision ||
    selectedOffice ||
    selectedReport;

  let chatbotSubtitle =
    "Choose a dashboard";

  if (selectedReport) {
    chatbotSubtitle =
      selectedReport.title;
  } else if (selectedOffice) {
    chatbotSubtitle =
      selectedOffice.name;
  } else if (selectedDivision) {
    chatbotSubtitle =
      selectedDivision.name;
  }

  // Position the chatbot beside the chat head.
  // On small screens, use a normal full-width mobile layout.
  const isMobileChatbot = viewportSize.width < 640;

  const chatbotWindowWidth = Math.min(
    380,
    Math.max(300, viewportSize.width * 0.28)
  );

  const chatbotWindowHeight = Math.min(
    620,
    viewportSize.height - 120
  );

  const chatHeadSize =
    viewportSize.width >= 1024
      ? 144
      : viewportSize.width >= 640
        ? 128
        : 112;

  const popupGap = 14;
  const viewportPadding = 12;

  const roomOnLeft =
    chatbotPosition.x -
    popupGap -
    chatbotWindowWidth;

  const roomOnRight =
    viewportSize.width -
    (chatbotPosition.x + chatHeadSize) -
    popupGap -
    chatbotWindowWidth;

  let chatbotPopupLeft;

  if (roomOnLeft >= viewportPadding) {
    chatbotPopupLeft =
      chatbotPosition.x -
      popupGap -
      chatbotWindowWidth;
  } else if (roomOnRight >= viewportPadding) {
    chatbotPopupLeft =
      chatbotPosition.x +
      chatHeadSize +
      popupGap;
  } else {
    chatbotPopupLeft = Math.max(
      viewportPadding,
      Math.min(
        chatbotPosition.x,
        viewportSize.width -
          chatbotWindowWidth -
          viewportPadding
      )
    );
  }

  const chatbotPopupTop = Math.max(
    viewportPadding,
    Math.min(
      chatbotPosition.y +
        chatHeadSize / 2 -
        chatbotWindowHeight / 2,
      viewportSize.height -
        chatbotWindowHeight -
        viewportPadding
    )
  );

  return (
    <div className="min-h-screen font-sans selection:bg-[#DCEFD9] selection:text-[#235E26] scroll-smooth text-slate-900">
      <Routes>
        {/* PUBLIC ROUTES */}

        <Route
          path="/"
          element={<Home />}
        />

        <Route
          path="/office/:officeId"
          element={<OfficeLayout />}
        />

        <Route
          path="/feedback"
          element={<Feedback />}
        />

        <Route
          path="/about"
          element={<About />}
        />

        <Route
          path="/chatbot"
          element={<Chatbot />}
        />

        <Route
          path="/user-guide"
          element={<UserGuide />}
        />

        {/* AUTHENTICATION ROUTES */}

        <Route
          path="/login"
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />

        <Route
          path="/register"
          element={
            <PublicRoute>
              <Register />
            </PublicRoute>
          }
        />

        {/* PROTECTED ROUTES */}

        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <StaffDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/users"
          element={
            <ProtectedRoute
              requiresAdmin={true}
            >
              <UserManagement />
            </ProtectedRoute>
          }
        />

        <Route
          path="/office-division-management"
          element={
            <ProtectedRoute
              requiresAdmin={true}
            >
              <OfficeDivisionManagement />
            </ProtectedRoute>
          }
        />

        <Route
          path="/activity-logs"
          element={
            <ProtectedRoute
              requiresAdmin={true}
            >
              <ActivityLog />
            </ProtectedRoute>
          }
        />

        <Route
          path="/help"
          element={
            <ProtectedRoute>
              <Help />
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={<NotFound />}
        />

        <Route
          path="/feedback-management"
          element={<FeedbackManagement />}
        />
      </Routes>

      {/* =====================================================
          FLOATING CHATBOT
      ===================================================== */}

      {isChatbotOpen && (
        <div
          className="
            fixed
            z-[9998]

            flex
            flex-col

            overflow-hidden

            rounded-2xl
            border
            border-[#B8D5B6]

            bg-white

            shadow-2xl
          "
          style={
            isMobileChatbot
              ? {
                  top: "88px",
                  left: "12px",
                  right: "12px",
                  width: "auto",
                  height:
                    "calc(100dvh - 105px)",
                  maxHeight:
                    "calc(100dvh - 105px)",
                }
              : {
                  left: `${chatbotPopupLeft}px`,
                  top: `${chatbotPopupTop}px`,
                  width: `${chatbotWindowWidth}px`,
                  height: `${chatbotWindowHeight}px`,
                  maxHeight: "72dvh",
                }
          }
        >
          {/* =================================================
              CHATBOT HEADER
          ================================================= */}

          <div
            className="
              flex
              min-h-[68px]
              shrink-0
              items-center
              justify-between

              bg-[#235E26]

              px-4
              py-3
            "
          >
            <div className="flex min-w-0 items-center gap-2">
              {showBackButton && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="
                    flex
                    h-8
                    w-8
                    shrink-0
                    items-center
                    justify-center

                    rounded-full

                    text-lg
                    text-white

                    transition

                    hover:bg-white/15
                  "
                  aria-label="Go back"
                >
                  ←
                </button>
              )}

              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-white">
                  I-DAmag Chatbot 
                </h2>

                <p className="truncate text-xs text-[#EAF4E8]">
                  {chatbotSubtitle}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCloseChatbot}
              className="
                flex
                h-8
                w-8
                shrink-0
                items-center
                justify-center

                rounded-full

                text-xl
                leading-none
                text-white

                transition

                hover:bg-white/15
              "
              aria-label="Close chatbot"
            >
              ×
            </button>
          </div>

          {/* =================================================
              LOADING
          ================================================= */}

          {selectionLoading && (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[#F5FAF4] px-5 text-center">
              <div
                className="
                  h-9
                  w-9

                  animate-spin

                  rounded-full

                  border-4
                  border-[#D7E7D5]
                  border-t-[#235E26]
                "
              />

              <p className="mt-4 text-xs text-[#4F7D45]">
                Loading available options...
              </p>
            </div>
          )}

          {/* =================================================
              ERROR
          ================================================= */}

          {!selectionLoading &&
            selectionError && (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-[#F5FAF4] px-5 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-xl text-red-600">
                  !
                </div>

                <p className="font-bold text-slate-800">
                  Unable to load data
                </p>

                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  {selectionError}
                </p>

                <button
                  type="button"
                  onClick={handleRetry}
                  className="
                    mt-4

                    rounded-xl

                    bg-[#2F6F32]

                    px-4
                    py-2

                    text-xs
                    font-semibold
                    text-white

                    transition

                    hover:bg-[#235E26]
                  "
                >
                  Try again
                </button>
              </div>
            )}

          {/* =================================================
              STEP 1 - DIVISION
          ================================================= */}

          {!selectionLoading &&
            !selectionError &&
            !selectedDivision && (
              <div className="min-h-0 flex-1 overflow-y-auto bg-[#F5FAF4] p-4">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-[#235E26]">
                    Select a division
                  </h3>

                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Choose the division whose
                    data you want to ask about.
                  </p>
                </div>

                {divisions.length > 0 ? (
                  <div className="space-y-2.5">
                    {divisions.map(
                      (division) => (
                        <button
                          key={division.id}
                          type="button"
                          onClick={() =>
                            handleSelectDivision(
                              division
                            )
                          }
                          className="
                            group

                            w-full

                            rounded-xl

                            border
                            border-[#D7E7D5]

                            bg-white

                            px-3
                            py-3

                            text-left

                            transition

                            hover:border-[#2F6F32]
                            hover:bg-[#EAF4E8]
                            hover:shadow-sm
                          "
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-[#235E26]">
                                {division.acronym ||
                                  division.code}
                              </p>

                              <p className="mt-1 text-xs font-semibold text-slate-700">
                                {division.name}
                              </p>

                              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                {
                                  division.description
                                }
                              </p>
                            </div>

                            <span
                              className="
                                shrink-0

                                text-xl
                                text-[#7AA574]

                                transition

                                group-hover:translate-x-1
                                group-hover:text-[#235E26]
                              "
                            >
                              ›
                            </span>
                          </div>
                        </button>
                      )
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-[200px] flex-col items-center justify-center text-center">
                    <p className="text-sm font-semibold text-slate-800">
                      No divisions available
                    </p>

                    <p className="mt-2 text-xs text-slate-500">
                      No divisions were returned
                      from the database.
                    </p>
                  </div>
                )}
              </div>
            )}

          {/* =================================================
              STEP 2 - OFFICE / SECTION
          ================================================= */}

          {!selectionLoading &&
            !selectionError &&
            selectedDivision &&
            !selectedOffice && (
              <div className="min-h-0 flex-1 overflow-y-auto bg-[#F5FAF4] p-4">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-[#235E26]">
                    Select an office or section
                  </h3>

                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Choose an office or section
                    under{" "}
                    <strong className="text-[#2F6F32]">
                      {selectedDivision.name}
                    </strong>
                    .
                  </p>
                </div>

                {offices.length > 0 ? (
                  <div className="space-y-2.5">
                    {offices.map((office) => (
                      <button
                        key={office.id}
                        type="button"
                        onClick={() =>
                          handleSelectOffice(
                            office
                          )
                        }
                        className="
                          group

                          w-full

                          rounded-xl

                          border
                          border-[#D7E7D5]

                          bg-white

                          px-3
                          py-3

                          text-left

                          transition

                          hover:border-[#2F6F32]
                          hover:bg-[#EAF4E8]
                          hover:shadow-sm
                        "
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            {office.acronym && (
                              <p className="text-sm font-bold text-[#235E26]">
                                {
                                  office.acronym
                                }
                              </p>
                            )}

                            <p className="mt-1 text-xs font-semibold text-slate-700">
                              {office.name}
                            </p>
                          </div>

                          <span className="shrink-0 text-xl text-[#7AA574] transition group-hover:translate-x-1 group-hover:text-[#235E26]">
                            ›
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[200px] flex-col items-center justify-center text-center">
                    <p className="text-sm font-semibold text-slate-800">
                      No offices or sections
                    </p>

                    <p className="mt-2 text-xs text-slate-500">
                      This division currently has
                      no offices or sections.
                    </p>
                  </div>
                )}
              </div>
            )}

          {/* =================================================
              STEP 3 - REPORT
          ================================================= */}

          {!selectionLoading &&
            !selectionError &&
            selectedOffice &&
            !selectedReport && (
              <div className="min-h-0 flex-1 overflow-y-auto bg-[#F5FAF4] p-4">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-[#235E26]">
                    Select a report
                  </h3>

                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Choose a report under{" "}
                    <strong className="text-[#2F6F32]">
                      {selectedOffice.name}
                    </strong>
                    .
                  </p>
                </div>

                {reports.length > 0 ? (
                  <div className="space-y-2.5">
                    {reports.map((report) => (
                      <button
                        key={report.id}
                        type="button"
                        onClick={() =>
                          handleSelectReport(
                            report
                          )
                        }
                        className={`group w-full rounded-xl border px-3 py-3 text-left transition ${
                          report.hasSheet
                            ? "border-[#D7E7D5] bg-white hover:border-[#2F6F32] hover:bg-[#EAF4E8] hover:shadow-sm"
                            : "border-[#D7E7D5] bg-[#F1F6F0]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800">
                              {report.title}
                            </p>

                            {report.description && (
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                {
                                  report.description
                                }
                              </p>
                            )}

                            <p
                              className={`mt-2 text-[11px] font-semibold ${
                                report.hasSheet
                                  ? "text-[#2F6F32]"
                                  : "text-[#6F8F6B]"
                              }`}
                            >
                              {report.hasSheet
                                ? "Google Sheet connected"
                                : "No Google Sheet connected"}
                            </p>
                          </div>

                          <span className="shrink-0 text-xl text-[#7AA574] transition group-hover:translate-x-1 group-hover:text-[#235E26]">
                            ›
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[200px] flex-col items-center justify-center text-center">
                    <p className="text-sm font-semibold text-slate-800">
                      No reports available
                    </p>

                    <p className="mt-2 text-xs text-slate-500">
                      This office or section
                      currently has no reports.
                    </p>
                  </div>
                )}
              </div>
            )}

          {/* =================================================
              STEP 4 - CHAT
          ================================================= */}

          {!selectionLoading &&
            !selectionError &&
            selectedReport && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Selected report */}

                <div className="shrink-0 border-b border-[#D7E7D5] bg-[#EAF4E8] px-4 py-2.5">
                  <p className="truncate text-xs font-bold text-[#235E26]">
                    {selectedReport.title}
                  </p>

                  <p
                    className={`mt-1 text-[10px] ${
                      selectedReport.hasSheet
                        ? "text-[#2F6F32]"
                        : "text-[#6F8F6B]"
                    }`}
                  >
                    {selectedReport.hasSheet
                      ? "Using the connected Google Sheet"
                      : "No Google Sheet is connected"}
                  </p>
                </div>

                {/* Messages */}

                <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-[#F5FAF4] p-3">
                  {messages.map(
                    (message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`flex ${
                          message.role ===
                          "user"
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2.5 text-xs leading-relaxed ${
                            message.role ===
                            "user"
                              ? "rounded-br-md bg-[#2F6F32] text-white"
                              : "rounded-tl-md border border-[#D7E7D5] bg-white text-slate-700 shadow-sm"
                          }`}
                        >
                          {message.text}
                        </div>
                      </div>
                    )
                  )}

                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="rounded-2xl rounded-tl-md border border-[#D7E7D5] bg-white px-3 py-2.5 text-xs text-[#4F7D45] shadow-sm">
                        Checking the Google
                        Sheet...
                      </div>
                    </div>
                  )}
                </div>

                {/* Input */}

                <div className="shrink-0 border-t border-[#D7E7D5] bg-white p-3">
                  <div className="flex items-end gap-2">
                    <textarea
                      rows={1}
                      value={question}
                      onChange={(event) =>
                        setQuestion(
                          event.target.value
                        )
                      }
                      onKeyDown={
                        handleQuestionKeyDown
                      }
                      disabled={
                        chatLoading ||
                        !selectedReport.hasSheet
                      }
                      placeholder={
                        selectedReport.hasSheet
                          ? "Ask about the report..."
                          : "No Google Sheet..."
                      }
                      className="
                        min-h-[42px]
                        max-h-24
                        min-w-0
                        flex-1
                        resize-none

                        rounded-xl

                        border
                        border-[#B8D5B6]

                        px-3
                        py-2.5

                        text-xs
                        text-slate-700

                        outline-none

                        transition

                        focus:border-[#235E26]
                        focus:ring-2
                        focus:ring-[#EAF4E8]

                        disabled:cursor-not-allowed
                        disabled:bg-[#F5FAF4]
                      "
                    />

                    <button
                      type="button"
                      onClick={sendQuestion}
                      disabled={
                        chatLoading ||
                        !question.trim() ||
                        !selectedReport.hasSheet
                      }
                      className="
                        flex
                        h-10
                        w-10
                        shrink-0
                        items-center
                        justify-center

                        rounded-full

                        bg-[#2F6F32]

                        text-white

                        transition

                        hover:bg-[#235E26]

                        disabled:cursor-not-allowed
                        disabled:bg-[#B8D5B6]
                      "
                      aria-label="Send message"
                    >
                      ➤
                    </button>
                  </div>
                </div>
              </div>
            )}
        </div>
      )}

      <FloatingChatbotButton
        onClick={handleToggleChatbot}
        isOpen={isChatbotOpen}
        position={chatbotPosition}
        setPosition={setChatbotPosition}
      />
    </div>
  );
}

export default App;