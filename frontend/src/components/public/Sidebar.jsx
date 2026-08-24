import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  NavLink,
  Link,
} from "react-router-dom";

import { getOffices } from "../../constants/offices";

import {
  ChevronLeft,
  ChevronRight,
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
  const acronym = String(office?.acronym || "").trim().toUpperCase();
  const name = String(office?.name || "").trim().toLowerCase();

  const iconMap = {
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

  if (iconMap[acronym]) return iconMap[acronym];

  if (name.includes("agricultural production")) return Wheat;
  if (name.includes("agricultural programs")) return Sprout;
  if (name.includes("administration")) return Settings;
  if (name.includes("farmers") || name.includes("beneficiaries")) return Users;
  if (name.includes("animal health")) return HeartPulse;
  if (name.includes("financial management")) return Banknote;
  if (name.includes("infrastructure")) return Construction;
  if (name.includes("research") || name.includes("technical services")) return FlaskConical;

  return LayoutGrid;
};

function Sidebar({
  activeOfficeId,
  isCollapsed,
  isOpen,
  onClose,
  isManualCollapsed,
  setIsManualCollapsed,
  divisions = [],
  selectedDivision,
  setSelectedDivision,
}) {
  const [offices, setOffices] = useState([]);
  const [officesLoading, setOfficesLoading] =
    useState(true);
  const [officesError, setOfficesError] =
    useState("");

  // ============================================================
  // MOBILE SWIPE
  // ============================================================

  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  const SWIPE_DISTANCE = 60;

  useEffect(() => {
    const handleTouchStart = (event) => {
      if (window.innerWidth >= 768) return;

      const touch = event.touches[0];

      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
    };

    const handleTouchEnd = (event) => {
      if (window.innerWidth >= 768) return;

      if (
        touchStartX.current === null ||
        touchStartY.current === null
      ) {
        return;
      }

      const touch = event.changedTouches[0];

      const endX = touch.clientX;
      const endY = touch.clientY;

      const distanceX =
        endX - touchStartX.current;

      const distanceY =
        endY - touchStartY.current;

      /*
       * Ignore vertical scrolling.
       * Swipe must be mostly horizontal.
       */
      if (
        Math.abs(distanceY) >
        Math.abs(distanceX)
      ) {
        touchStartX.current = null;
        touchStartY.current = null;

        return;
      }

      // ----------------------------------------------------------
      // CLOSE
      // Swipe LEFT while sidebar is open
      // ----------------------------------------------------------

      if (
        isOpen &&
        distanceX <= -SWIPE_DISTANCE
      ) {
        onClose();
      }

      touchStartX.current = null;
      touchStartY.current = null;
    };

    document.addEventListener(
      "touchstart",
      handleTouchStart,
      {
        passive: true,
      }
    );

    document.addEventListener(
      "touchend",
      handleTouchEnd,
      {
        passive: true,
      }
    );

    return () => {
      document.removeEventListener(
        "touchstart",
        handleTouchStart
      );

      document.removeEventListener(
        "touchend",
        handleTouchEnd
      );
    };
  }, [isOpen, onClose]);

  // ============================================================
  // LOAD OFFICES
  // ============================================================

  useEffect(() => {
    let isMounted = true;

    const loadOffices = async () => {
      try {
        setOfficesLoading(true);
        setOfficesError("");

        const data = await getOffices();

        if (!isMounted) return;

        setOffices(
          Array.isArray(data) ? data : []
        );
      } catch (error) {
        if (!isMounted) return;

        console.error(
          "Error loading offices:",
          error
        );

        setOffices([]);

        setOfficesError(
          error.message ||
            "Unable to load offices."
        );
      } finally {
        if (isMounted) {
          setOfficesLoading(false);
        }
      }
    };

    loadOffices();

    return () => {
      isMounted = false;
    };
  }, []);

  // ============================================================
  // MOBILE HELPERS
  // ============================================================

  const handleMobileClose = () => {
    if (window.innerWidth < 768) {
      onClose();
    }
  };



  return (
    <>
      {/* ========================================================
          MOBILE BACKDROP
      ======================================================== */}

      {isOpen && (
        <div
          className="
            fixed inset-0
            bg-slate-900/40
            backdrop-blur-sm
            z-40
            md:hidden
            transition-opacity
            duration-300
          "
          onClick={onClose}
        />
      )}

      {/* ========================================================
          SIDEBAR
      ======================================================== */}

      <aside
        className={`
          fixed
          inset-y-0
          left-0
          z-50

          ${
            isOpen
              ? "translate-x-0"
              : "-translate-x-full"
          }

          md:relative
          md:translate-x-0

          ${
            isCollapsed
              ? "md:w-20"
              : "md:w-80"
          }

          w-72
          h-full

          bg-white

          border-r
          border-slate-200

          flex
          flex-col
          flex-shrink-0

          transition-all
          duration-500
          ease-in-out
        `}
      >

        {/* ======================================================
            DESKTOP COLLAPSE TOGGLE
        ====================================================== */}

        <button
          type="button"
          onClick={() =>
            setIsManualCollapsed(
              !isManualCollapsed
            )
          }
          className="
            hidden
            md:flex

            absolute
            -right-3
            top-24

            w-6
            h-6

            bg-white

            border
            border-slate-200

            rounded-full

            items-center
            justify-center

            text-slate-400

            hover:text-moss-600
            hover:border-moss-200
            hover:shadow-md

            transition-all

            z-10
          "
          aria-label={
            isManualCollapsed
              ? "Expand sidebar"
              : "Collapse sidebar"
          }
        >
          {isManualCollapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5" />
          )}
        </button>

        {/* ======================================================
            HOME
        ====================================================== */}

        <div
          className={`
            p-5
            mb-4

            border-b
            border-slate-100

            ${
              isCollapsed
                ? "md:flex md:justify-center"
                : "md:p-8"
            }
          `}
        >
          <Link
            to="/"
            onClick={handleMobileClose}
            className={`
              flex
              items-center
              gap-3

              text-slate-800

              hover:text-moss-600

              transition-colors

              group

              ${
                isCollapsed
                  ? "md:justify-center"
                  : ""
              }
            `}
            title={
              isCollapsed ? "Home" : ""
            }
          >
            <div
              className="
                w-10
                h-10

                bg-moss-50

                rounded-xl

                flex
                items-center
                justify-center

                group-hover:bg-moss-100

                transition-colors

                flex-shrink-0
              "
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-moss-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="
                    M3 12l2-2m0 0l7-7 7 7
                    M5 10v10a1 1 0 001 1h3
                    m10-11l2 2m-2-2v10
                    a1 1 0 01-1 1h-3
                    m-6 0a1 1 0 001-1v-4
                    a1 1 0 011-1h2
                    a1 1 0 011 1v4
                    a1 1 0 001 1m-6 0h6
                  "
                />
              </svg>
            </div>

            {(!isCollapsed ||
              window.innerWidth < 768) && (
              <span className="text-xl font-bold tracking-tight">
                Home
              </span>
            )}
          </Link>
        </div>

        {/* ======================================================
            OFFICES
        ====================================================== */}

        <nav
          className={`
            flex-grow
            overflow-y-auto
            overscroll-contain

            pb-8

            custom-scrollbar

            ${
              isCollapsed
                ? "md:px-2"
                : "px-4"
            }
          `}
        >
          <div className="space-y-2">

            {(!isCollapsed ||
              window.innerWidth < 768) && (
              <p
                className="
                  px-4

                  text-[10px]
                  font-bold
                  text-slate-400

                  uppercase
                  tracking-[0.2em]

                  mb-4
                "
              >
                Offices
              </p>
            )}

            {/* Loading */}
            {officesLoading && (
              <div className="px-4 py-4 text-sm text-slate-400">
                Loading offices...
              </div>
            )}

            {/* Error */}
            {!officesLoading &&
              officesError && (
                <div className="px-4 py-4">
                  <p className="text-xs font-semibold text-red-600">
                    Unable to load offices
                  </p>

                  <p className="mt-1 text-[10px] text-slate-400">
                    {officesError}
                  </p>
                </div>
              )}

            {/* Empty */}
            {!officesLoading &&
              !officesError &&
              offices.length === 0 && (
                <div className="px-4 py-4 text-sm text-slate-400">
                  No offices available.
                </div>
              )}

            {/* Office Items */}
            {!officesLoading &&
              !officesError &&
              offices.map((office) => {
                const IconComponent = getCategoryIcon(office);

                const isActive =
                  Number(activeOfficeId) ===
                  Number(office.id);

                return (
                  <div
                    key={office.id}
                    className="space-y-1"
                  >
                    <NavLink
                      to={`/office/${office.id}`}
                      onClick={(event) => {
                        if (isActive) {
                          event.preventDefault();
                        }

                        handleMobileClose();
                      }}
                      title={
                        isCollapsed
                          ? office.acronym
                          : ""
                      }
                      className={`
                        flex
                        items-center
                        rounded-2xl

                        transition-all
                        duration-300

                        group

                        ${
                          isCollapsed
                            ? "md:justify-center md:p-2"
                            : "gap-4 px-4 py-3"
                        }

                        ${
                          isActive
                            ? "bg-moss-600 text-white shadow-lg shadow-moss-600/20"
                            : "text-slate-600 hover:bg-moss-50 hover:text-moss-700"
                        }

                        ${
                          !isCollapsed ||
                          window.innerWidth < 768
                            ? "gap-4 px-4 py-3"
                            : ""
                        }
                      `}
                    >
                      <div
                        className={`
                          w-10
                          h-10

                          rounded-xl

                          flex
                          items-center
                          justify-center

                          transition-colors

                          flex-shrink-0

                          ${
                            isActive
                              ? "bg-white/20"
                              : "bg-slate-50 group-hover:bg-white"
                          }
                        `}
                      >
                        {IconComponent && (
                          <IconComponent
                            className={`
                              w-5
                              h-5

                              ${
                                isActive
                                  ? "text-white"
                                  : "text-moss-600"
                              }
                            `}
                          />
                        )}
                      </div>

                      {(!isCollapsed ||
                        window.innerWidth <
                          768) && (
                        <div className="flex flex-col min-w-0">
                          <span className="font-bold text-sm leading-tight truncate">
                            {office.acronym ||
                              "N/A"}
                          </span>

                          <span
                            className={`
                              text-[10px]
                              truncate

                              ${
                                isActive
                                  ? "text-white/70"
                                  : "text-slate-400"
                              }
                            `}
                          >
                            {office.name}
                          </span>
                        </div>
                      )}
                    </NavLink>

                    {/* ==========================================
                        SECTIONS OF ACTIVE OFFICE
                    ========================================== */}

                    {isActive &&
                      !isCollapsed &&
                      divisions.length >
                        0 && (
                        <div
                          className="
                            pl-6
                            space-y-1

                            animate-in
                            slide-in-from-top-2
                            duration-300
                          "
                        >
                          <div className="space-y-1 pr-2">

                            {divisions.map(
                              (division) => (
                                <button
                                  type="button"
                                  key={
                                    division.id
                                  }
                                  onClick={() => {
                                    setSelectedDivision(
                                      division
                                    );

                                    handleMobileClose();
                                  }}
                                  className={`
                                    w-full
                                    text-left

                                    px-4
                                    py-2.5

                                    rounded-xl

                                    text-xs
                                    font-bold

                                    transition-all

                                    relative
                                    overflow-hidden

                                    ${
                                      selectedDivision?.id ===
                                      division.id
                                        ? "bg-moss-50 text-moss-700"
                                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                                    }
                                  `}
                                >
                                  <span className="relative z-10">
                                    {
                                      division.name
                                    }
                                  </span>

                                  {selectedDivision?.id ===
                                    division.id && (
                                    <div
                                      className="
                                        absolute
                                        left-0
                                        top-1/4
                                        bottom-1/4

                                        w-0.5

                                        bg-moss-600

                                        rounded-full
                                      "
                                    />
                                  )}
                                </button>
                              )
                            )}

                          </div>
                        </div>
                      )}
                  </div>
                );
              })}
          </div>
        </nav>
      </aside>
    </>
  );
}

export default Sidebar;