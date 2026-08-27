import React, { useEffect, useState } from "react";

const API_URL = (
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000/api"
).replace(/\/$/, "");

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const responseText = await response.text();

    console.error("Non-JSON server response:", responseText);

    throw new Error(
      `The server did not return valid JSON. HTTP ${response.status}.`
    );
  }

  return response.json();
}


/**
 * Safely render the small Markdown subset used by chatbot answers.
 *
 * Supported:
 *   **bold**
 *   line breaks / numbered lists / bullets are preserved by
 *   the existing whitespace-pre-wrap class.
 *
 * This deliberately avoids dangerouslySetInnerHTML and does not require
 * an additional frontend package.
 */
function renderChatMessage(text) {
  const value = String(text ?? "");

  if (!value) {
    return "";
  }

  const parts = value.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/s);

    if (boldMatch) {
      return (
        <strong
          key={`chat-bold-${index}`}
          className="font-bold"
        >
          {boldMatch[1]}
        </strong>
      );
    }

    return (
      <React.Fragment key={`chat-text-${index}`}>
        {part}
      </React.Fragment>
    );
  });
}

const Chatbot = () => {
  const [divisions, setDivisions] = useState([]);
  const [offices, setOffices] = useState([]);
  const [reports, setReports] = useState([]);

  const [selectedDivision, setSelectedDivision] = useState("");
  const [selectedOffice, setSelectedOffice] = useState("");
  const [selectedReport, setSelectedReport] = useState("");

  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState("");

  const [question, setQuestion] = useState("");

  const [messages, setMessages] = useState([
    {
      role: "bot",
      text: "Hello! Select a division, office or section, and report before asking a question.",
    },
  ]);

  const [loading, setLoading] = useState(false);

  // =========================================================
  // LOAD DIVISIONS
  // =========================================================
  useEffect(() => {
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

        if (isMounted) {
          setDivisions(
            Array.isArray(data.divisions)
              ? data.divisions
              : []
          );
        }
      } catch (error) {
        console.error("Error loading divisions:", error);

        if (isMounted) {
          setDivisions([]);

          setSelectionError(
            error.message ||
              "Unable to load divisions."
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
  }, []);

  // =========================================================
  // LOAD OFFICES / SECTIONS
  // =========================================================
  useEffect(() => {
    let isMounted = true;

    const loadOffices = async () => {
      setOffices([]);
      setReports([]);
      setSelectedOffice("");
      setSelectedReport("");

      if (!selectedDivision) return;

      try {
        setSelectionLoading(true);
        setSelectionError("");

        const response = await fetch(
          `${API_URL}/chatbot/offices?divisionId=${encodeURIComponent(
            selectedDivision
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
              "Unable to load offices."
          );
        }

        if (isMounted) {
          setOffices(
            Array.isArray(data.offices)
              ? data.offices
              : []
          );
        }
      } catch (error) {
        console.error("Error loading offices:", error);

        if (isMounted) {
          setOffices([]);

          setSelectionError(
            error.message ||
              "Unable to load offices."
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

  // =========================================================
  // LOAD REPORTS
  // =========================================================
  useEffect(() => {
    let isMounted = true;

    const loadReports = async () => {
      setReports([]);
      setSelectedReport("");

      if (!selectedOffice) return;

      try {
        setSelectionLoading(true);
        setSelectionError("");

        const response = await fetch(
          `${API_URL}/chatbot/reports?officeId=${encodeURIComponent(
            selectedOffice
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

        if (isMounted) {
          setReports(
            Array.isArray(data.reports)
              ? data.reports
              : []
          );
        }
      } catch (error) {
        console.error("Error loading reports:", error);

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

  // =========================================================
  // DIVISION CHANGE
  // =========================================================
  const handleDivisionChange = (event) => {
    setSelectedDivision(event.target.value);
    setSelectedOffice("");
    setSelectedReport("");
    setSelectionError("");

    setMessages([
      {
        role: "bot",
        text: "Now select an office or section.",
      },
    ]);
  };

  // =========================================================
  // OFFICE CHANGE
  // =========================================================
  const handleOfficeChange = (event) => {
    setSelectedOffice(event.target.value);
    setSelectedReport("");
    setSelectionError("");

    setMessages([
      {
        role: "bot",
        text: "Now select the report you want to ask questions about.",
      },
    ]);
  };

  // =========================================================
  // REPORT CHANGE
  // =========================================================
  const handleReportChange = (event) => {
    const reportId = event.target.value;

    setSelectedReport(reportId);
    setSelectionError("");

    const report = reports.find(
      (item) =>
        Number(item.id) === Number(reportId)
    );

    if (!report) return;

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
        text: `You selected "${report.title}". You can now ask questions about its Google Sheet data.`,
      },
    ]);
  };

  // =========================================================
  // SEND QUESTION
  // =========================================================
  const sendQuestion = async () => {
    const trimmedQuestion = question.trim();

    const report = reports.find(
      (item) =>
        Number(item.id) === Number(selectedReport)
    );

    if (
      !trimmedQuestion ||
      loading ||
      !selectedReport
    ) {
      return;
    }

    if (!report?.hasSheet) {
      setMessages((current) => [
        ...current,
        {
          role: "bot",
          text: "The selected report does not have a Google Sheet connected.",
        },
      ]);

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
    setLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/chatbot/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            question: trimmedQuestion,
            reportId: Number(selectedReport),
          }),
        }
      );

      const data = await readJsonResponse(response);

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
      console.error("Chatbot error:", error);

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
      setLoading(false);
    }
  };

  // =========================================================
  // ENTER KEY
  // =========================================================
  const handleKeyDown = (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      sendQuestion();
    }
  };

  const selectedReportData = reports.find(
    (report) =>
      Number(report.id) === Number(selectedReport)
  );

  const canChat =
    Boolean(selectedDivision) &&
    Boolean(selectedOffice) &&
    Boolean(selectedReport) &&
    Boolean(selectedReportData?.hasSheet);

  return (
    <div
      className="
        fixed
        z-[9998]

        top-[96px]
        right-3

        w-[28vw]
        min-w-[300px]
        max-w-[380px]

        max-h-[72dvh]

        flex
        flex-col

        bg-white

        border
        border-slate-200

        rounded-2xl

        shadow-2xl

        overflow-hidden

        max-sm:top-[88px]
        max-sm:left-3
        max-sm:right-3
        max-sm:w-auto
        max-sm:min-w-0
        max-sm:max-w-none
        max-sm:max-h-[68dvh]
      "
    >
      {/* CHATBOT HEADER */}
      <div
        className="
          shrink-0
          bg-green-800
          px-4
          py-3
          text-white
        "
      >
        <h1 className="text-base sm:text-lg font-bold">
          iDamag Chatbot
        </h1>

        <p className="mt-1 text-[11px] sm:text-xs text-green-100">
          Select a division, office or section, and report before
          asking about its data.
        </p>
      </div>

      {/* SELECTION AREA */}
      <div
        className="
          shrink-0
          border-b
          border-slate-200
          bg-white
          p-3
          max-h-[34dvh]
          overflow-y-auto
        "
      >
        <div className="grid grid-cols-1 gap-3">

          {/* DIVISION */}
          <div>
            <label
              htmlFor="division"
              className="
                mb-1
                block
                text-[10px]
                sm:text-[11px]
                font-bold
                uppercase
                tracking-wider
                text-slate-500
              "
            >
              1. Division
            </label>

            <select
              id="division"
              value={selectedDivision}
              onChange={handleDivisionChange}
              disabled={selectionLoading}
              className="
                w-full
                rounded-xl
                border
                border-slate-300
                bg-white
                px-3
                py-2
                text-xs
                sm:text-sm
                text-slate-700
                outline-none
                transition
                focus:border-green-700
                focus:ring-2
                focus:ring-green-100
                disabled:cursor-not-allowed
                disabled:bg-slate-100
              "
            >
              <option value="">
                Select Division
              </option>

              {divisions.map((division) => (
                <option
                  key={division.id}
                  value={division.id}
                >
                  {division.acronym
                    ? `${division.acronym} - ${division.name}`
                    : division.name}
                </option>
              ))}
            </select>
          </div>

          {/* OFFICE */}
          <div>
            <label
              htmlFor="office"
              className="
                mb-1
                block
                text-[10px]
                sm:text-[11px]
                font-bold
                uppercase
                tracking-wider
                text-slate-500
              "
            >
              2. Office / Section
            </label>

            <select
              id="office"
              value={selectedOffice}
              onChange={handleOfficeChange}
              disabled={
                !selectedDivision ||
                selectionLoading
              }
              className="
                w-full
                rounded-xl
                border
                border-slate-300
                bg-white
                px-3
                py-2
                text-xs
                sm:text-sm
                text-slate-700
                outline-none
                transition
                focus:border-green-700
                focus:ring-2
                focus:ring-green-100
                disabled:cursor-not-allowed
                disabled:bg-slate-100
              "
            >
              <option value="">
                {selectedDivision
                  ? "Select Office or Section"
                  : "Select Division First"}
              </option>

              {offices.map((office) => (
                <option
                  key={office.id}
                  value={office.id}
                >
                  {office.acronym
                    ? `${office.acronym} - ${office.name}`
                    : office.name}
                </option>
              ))}
            </select>
          </div>

          {/* REPORT */}
          <div>
            <label
              htmlFor="report"
              className="
                mb-1
                block
                text-[10px]
                sm:text-[11px]
                font-bold
                uppercase
                tracking-wider
                text-slate-500
              "
            >
              3. Report
            </label>

            <select
              id="report"
              value={selectedReport}
              onChange={handleReportChange}
              disabled={
                !selectedOffice ||
                selectionLoading
              }
              className="
                w-full
                rounded-xl
                border
                border-slate-300
                bg-white
                px-3
                py-2
                text-xs
                sm:text-sm
                text-slate-700
                outline-none
                transition
                focus:border-green-700
                focus:ring-2
                focus:ring-green-100
                disabled:cursor-not-allowed
                disabled:bg-slate-100
              "
            >
              <option value="">
                {selectedOffice
                  ? "Select Report"
                  : "Select Office First"}
              </option>

              {reports.map((report) => (
                <option
                  key={report.id}
                  value={report.id}
                >
                  {report.title}
                  {!report.hasSheet
                    ? " — No Google Sheet"
                    : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* LOADING */}
        {selectionLoading && (
          <p className="mt-2 text-xs text-slate-500">
            Loading available options...
          </p>
        )}

        {/* ERROR */}
        {selectionError && (
          <p className="mt-2 text-xs font-semibold text-red-600">
            {selectionError}
          </p>
        )}

        {/* SELECTED REPORT */}
        {selectedReportData && (
          <div
            className={`
              mt-3
              rounded-xl
              border
              px-3
              py-2
              ${
                selectedReportData.hasSheet
                  ? "border-green-100 bg-green-50"
                  : "border-amber-200 bg-amber-50"
              }
            `}
          >
            <p
              className={`
                text-xs
                font-semibold
                ${
                  selectedReportData.hasSheet
                    ? "text-green-800"
                    : "text-amber-800"
                }
              `}
            >
              Selected report:{" "}
              {selectedReportData.title}
            </p>

            <p
              className={`
                mt-1
                text-[11px]
                ${
                  selectedReportData.hasSheet
                    ? "text-green-700"
                    : "text-amber-700"
                }
              `}
            >
              {selectedReportData.hasSheet
                ? "The chatbot will use the Google Sheet connected to this report."
                : "This report has no Google Sheet URL configured."}
            </p>
          </div>
        )}
      </div>

      {/* MESSAGES */}
      <div
        className="
          min-h-0
          flex-1
          space-y-3
          overflow-y-auto
          bg-slate-50
          p-3
        "
      >
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`flex ${
              message.role === "user"
                ? "justify-end"
                : "justify-start"
            }`}
          >
            <div
              className={`
                max-w-[85%]
                whitespace-pre-wrap
                rounded-2xl
                px-3
                py-2.5
                text-xs
                sm:text-sm
                leading-relaxed
                ${
                  message.role === "user"
                    ? "bg-green-700 text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }
              `}
            >
              {renderChatMessage(message.text)}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div
              className="
                max-w-[85%]
                rounded-2xl
                border
                border-slate-200
                bg-white
                px-3
                py-2.5
                text-xs
                sm:text-sm
                text-slate-500
              "
            >
              Checking the selected report&apos;s Google Sheet...
            </div>
          </div>
        )}
      </div>

      {/* INPUT AREA */}
      <div
        className="
          shrink-0
          border-t
          border-slate-200
          bg-white
          p-3
        "
      >
        {!canChat && (
          <p
            className="
              mb-2
              text-center
              text-[10px]
              sm:text-xs
              font-medium
              text-amber-600
            "
          >
            Select a report with a connected Google Sheet to enable
            the chatbot.
          </p>
        )}

        <div
          className="
            flex
            items-end
            gap-2
            max-[380px]:flex-col
          "
        >
          <textarea
            value={question}
            onChange={(event) =>
              setQuestion(event.target.value)
            }
            onKeyDown={handleKeyDown}
            placeholder={
              canChat
                ? "Ask about the selected report..."
                : "Complete the selections first..."
            }
            rows={2}
            disabled={!canChat || loading}
            className="
              min-h-[44px]
              max-h-24
              w-full
              flex-1
              resize-none
              rounded-xl
              border
              border-slate-300
              px-3
              py-2
              text-xs
              sm:text-sm
              outline-none
              transition
              focus:border-green-700
              focus:ring-2
              focus:ring-green-100
              disabled:cursor-not-allowed
              disabled:bg-slate-100
            "
          />

          <button
            type="button"
            onClick={sendQuestion}
            disabled={
              loading ||
              !question.trim() ||
              !canChat
            }
            className="
              shrink-0
              rounded-xl
              bg-green-700
              px-5
              py-2.5
              text-xs
              sm:text-sm
              font-semibold
              text-white
              transition
              hover:bg-green-800
              active:scale-95
              disabled:cursor-not-allowed
              disabled:bg-slate-300
              disabled:active:scale-100
              max-[380px]:w-full
            "
          >
            {loading ? "Sending..." : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chatbot;