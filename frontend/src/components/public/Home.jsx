import React, { useEffect, useState } from "react";
import Header from "./Header";
import Footer from "./Footer";
import Hero from "./Hero";
import OfficeCard from "./OfficeCard";
import { getOffices } from "../../constants/offices";
import {
  AlertTriangle,
  MessageSquare,
  CheckCircle2,
} from "lucide-react";

function Home() {
  const [offices, setOffices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Work-in-progress modal
const NOTICE_SESSION_KEY = "idamag-development-notice-shown";

const [showNotice, setShowNotice] = useState(() => {
  return sessionStorage.getItem(NOTICE_SESSION_KEY) !== "true";
});
  const [comment, setComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentSubmitted, setCommentSubmitted] = useState(false);

const closeDevelopmentNotice = () => {
  sessionStorage.setItem(NOTICE_SESSION_KEY, "true");
  setShowNotice(false);
};
  /*
   * =========================================================
   * GOOGLE FORM SETTINGS
   * =========================================================
   *
   * Replace these with your actual Google Form details.
   *
   * Example form:
   * https://docs.google.com/forms/d/e/FORM_ID/viewform
   *
   * Example comment field:
   * entry.123456789
   */

  const GOOGLE_FORM_ACTION_URL =
    "https://docs.google.com/forms/d/e/1FAIpQLScTfjWfhn-oIbHgnrOHGRVsDYAEP0AFg3phMzjqzy1agedcaQ/formResponse";

  const WEBSITE_SUGGESTION_ENTRY_ID = "entry.673085768";

  useEffect(() => {
    const loadOffices = async () => {
      try {
        const data = await getOffices();
        setOffices(data);
      } catch (err) {
        console.error(err);
        setError("Unable to load categories.");
      } finally {
        setLoading(false);
      }
    };

    loadOffices();
  }, []);

  /*
   * Prevent page scrolling while modal is open.
   */
  useEffect(() => {
    if (showNotice) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [showNotice]);

  /*
   * Submit website suggestions directly to Google Forms.
   * IMPORTANT: form submissions must use /formResponse,
   * not /viewform.
   */
  const handleSubmitWebsiteSuggestion = async () => {
    const trimmedComment = comment.trim();

    if (!trimmedComment || submittingComment) return;

    setSubmittingComment(true);

    const formData = new FormData();
    formData.append(
      WEBSITE_SUGGESTION_ENTRY_ID,
      trimmedComment
    );

    try {
      await fetch(GOOGLE_FORM_ACTION_URL, {
        method: "POST",
        mode: "no-cors",
        body: formData,
      });

      setComment("");
      setCommentSubmitted(true);

      // Do not show the development notice again during this browser session.
      sessionStorage.setItem(NOTICE_SESSION_KEY, "true");
    } catch (error) {
      console.error(
        "Website suggestion submission failed:",
        error
      );

      alert(
        "Unable to submit your suggestion. Please try again."
      );
    } finally {
      setSubmittingComment(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">

      {/* =====================================================
          PAGE CONTENT
          Everything becomes blurred while modal is open
      ====================================================== */}

      <div
        className={`
          min-h-screen
          flex
          flex-col
          transition-all
          duration-300

          ${
            showNotice
              ? "blur-[3px] pointer-events-none select-none"
              : ""
          }
        `}
      >
        <Header />

        {/* Hero */}
        <Hero />

        {/* Categories */}
        <main
          id="links"
          className="
            flex-grow

            w-full
            max-w-7xl

            mx-auto

            px-4
            sm:px-6
            lg:px-8

            py-16
          "
        >
          <div className="text-center mb-16 space-y-4">
            <h2
              className="
                text-3xl
                md:text-4xl

                font-bold

                text-slate-900

                tracking-tight
              "
            >
              DA-RFO I Dashboard Categories
            </h2>

            <p
              className="
                text-slate-600

                max-w-2xl
                mx-auto
              "
            >
              Select Categories and Subcategories to access its dashboards, and reports.
            </p>
          </div>

          {loading ? (
            <div className="text-center py-20">
              <p className="text-slate-500 text-lg">
                Loading categories...
              </p>
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-red-600 font-semibold">
                {error}
              </p>
            </div>
          ) : (
            <div
              className="
                grid
                grid-cols-1
                md:grid-cols-2
                lg:grid-cols-3

                gap-6
                md:gap-8
              "
            >
              {offices.map((office) => (
                <OfficeCard
                  key={office.id}
                  office={office}
                />
              ))}
            </div>
          )}
        </main>

        <Footer />
      </div>


      {/* =====================================================
          WORK IN PROGRESS MODAL
      ====================================================== */}

      {showNotice && (
        <div
          className="
            fixed
            inset-0
            z-[9999]

            flex
            items-center
            justify-center

            px-4
            py-6

            bg-slate-950/45

            backdrop-blur-[2px]
          "
        >

          {/* Modal */}
          <div
            className="
              relative

              w-full
              max-w-xl

              overflow-hidden

              rounded-3xl

              bg-white

              shadow-2xl
              shadow-slate-950/25

              border
              border-white/60

              animate-[modalAppear_.25s_ease-out]
            "
          >

            {/* Decorative top section */}
            <div
              className="
                relative

                px-7
                sm:px-9

                pt-8
                pb-6

                bg-gradient-to-br
                from-[#173F32]
                via-[#245844]
                to-[#315F47]

                text-white
              "
            >

              {/* Decorative circle */}
              <div
                className="
                  absolute
                  -right-16
                  -top-16

                  w-44
                  h-44

                  rounded-full

                  bg-white/5
                "
              />

              <div
                className="
                  absolute
                  right-14
                  -bottom-16

                  w-32
                  h-32

                  rounded-full

                  bg-yellow-300/10
                "
              />

              <div className="relative z-10">

                <div
                  className="
                    inline-flex
                    items-center
                    gap-2

                    mb-5

                    px-3
                    py-1.5

                    rounded-full

                    bg-white/10

                    border
                    border-white/15

                    text-xs
                    font-bold

                    tracking-wide
                    uppercase
                  "
                >
                  <AlertTriangle className="w-4 h-4" />

                  Development Notice
                </div>

                <h2
                  className="
                    text-2xl
                    sm:text-3xl

                    font-extrabold

                    tracking-tight
                  "
                >
                  I-DAMAG is still a work in progress
                </h2>

                <p
                  className="
                    mt-3

                    max-w-lg

                    text-sm
                    sm:text-base

                    leading-7

                    text-white/80
                  "
                >
                  Some features, dashboards, and information
                  may still be under development. Your
                  comments and suggestions can help us improve
                  the system.
                </p>

              </div>
            </div>


            {/* Modal content */}
            <div className="px-7 sm:px-9 py-7">

              <div className="mb-5">
                <div
                  className="
                    flex
                    items-center
                    gap-2

                    mb-2
                  "
                >
                  <MessageSquare
                    className="
                      w-5
                      h-5

                      text-[#245844]
                    "
                  />

                  <label
                    htmlFor="work-progress-comment"
                    className="
                      text-sm
                      font-bold

                      text-slate-800
                    "
                  >
                    Have a comment or suggestion?
                  </label>
                </div>

                <p
                  className="
                    text-sm
                    leading-6

                    text-slate-500

                    mb-3
                  "
                >
                  Share your comments, suggestions, or issues below.
                  Your feedback will be submitted directly to our
                  Website Suggestions form.
                </p>

                {commentSubmitted ? (
                  <div
                    className="
                      flex
                      items-start
                      gap-3
                      rounded-2xl
                      border
                      border-green-200
                      bg-green-50
                      px-4
                      py-4
                    "
                  >
                    <CheckCircle2 className="w-5 h-5 text-green-700 mt-0.5 shrink-0" />

                    <div>
                      <p className="text-sm font-bold text-green-800">
                        Thank you for your suggestion!
                      </p>

                      <p className="mt-1 text-sm leading-6 text-green-700">
                        Your website feedback has been submitted successfully.
                      </p>
                    </div>
                  </div>
                ) : (
                  <textarea
                    id="work-progress-comment"
                    value={comment}
                    onChange={(e) =>
                      setComment(e.target.value)
                    }
                    placeholder="Share your comments, suggestions, or issues you encountered..."
                    rows={4}
                    className="
                      w-full

                      resize-none

                      rounded-2xl

                      border
                      border-slate-200

                      bg-slate-50

                      px-4
                      py-3.5

                      text-sm

                      text-slate-800

                      placeholder:text-slate-400

                      outline-none

                      transition

                      focus:border-[#245844]
                      focus:bg-white
                      focus:ring-4
                      focus:ring-[#245844]/10
                    "
                  />
                )}
              </div>


              {/* Buttons */}
              <div
                className="
                  flex
                  flex-col-reverse
                  sm:flex-row

                  sm:items-center
                  sm:justify-between

                  gap-3
                "
              >

                {/* Continue to website */}
                <button
                  type="button"
                  onClick={closeDevelopmentNotice}
                  className="
                    inline-flex
                    items-center
                    justify-center

                    min-h-[46px]

                    px-5
                    py-3

                    rounded-xl

                    border
                    border-slate-200

                    bg-white

                    text-sm
                    font-bold

                    text-slate-600

                    transition

                    hover:bg-slate-50
                    hover:text-slate-900
                  "
                >
                  Continue to Website
                </button>


                {!commentSubmitted && (
                  <button
                    type="button"
                    onClick={handleSubmitWebsiteSuggestion}
                    disabled={
                      !comment.trim() ||
                      submittingComment
                    }
                    className="
                      inline-flex
                      items-center
                      justify-center

                      gap-2

                      min-h-[46px]

                      px-6
                      py-3

                      rounded-xl

                      bg-[#173F32]

                      text-sm
                      font-bold

                      text-white

                      shadow-lg
                      shadow-[#173F32]/20

                      transition

                      hover:bg-[#245844]
                      hover:-translate-y-0.5

                      disabled:bg-slate-300
                      disabled:text-slate-500
                      disabled:shadow-none
                      disabled:cursor-not-allowed
                      disabled:translate-y-0
                    "
                  >
                    {submittingComment
                      ? "Submitting..."
                      : "Submit"}
                  </button>
                )}

              </div>


              <p
                className="
                  mt-5

                  text-center

                  text-xs
                  leading-5

                  text-slate-400
                "
              >
                You may continue using the system without
                submitting a suggestion.
              </p>

            </div>

          </div>
        </div>
      )}


      {/* Modal animation */}
      <style>
        {`
          @keyframes modalAppear {
            from {
              opacity: 0;
              transform: translateY(12px) scale(0.98);
            }

            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}
      </style>

    </div>
  );
}

export default Home;