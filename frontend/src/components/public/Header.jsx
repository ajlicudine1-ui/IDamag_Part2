import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import logo from "../../assets/dalogo.png";

const Header = () => {
  const location = useLocation();
  const isHomePage = location.pathname === "/";

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Close menu whenever route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <header
      className="
        sticky
        top-0
        z-50

        flex
        w-full
        items-center
        justify-between
        gap-2

        border-b
        border-slate-200

        bg-white/90
        backdrop-blur-md

        px-3
        py-2

        sm:gap-4
        sm:px-4
        sm:py-3

        md:px-8
        lg:px-14
      "
    >
      {/* LEFT SIDE */}
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        <Link
          to="/"
          className="
            group
            flex
            min-w-0
            flex-1
            items-center
            gap-2

            sm:gap-3
            md:gap-4
          "
        >
          {/* LOGO */}
          <img
            src={logo}
            alt="Department of Agriculture Logo"
            className="
              h-10
              w-10
              shrink-0
              object-contain

              transition-transform
              duration-500

              group-hover:rotate-6

              sm:h-12
              sm:w-12

              md:h-14
              md:w-14

              lg:h-16
              lg:w-16
            "
          />

          {/* TEXT */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* MAIN TITLE */}
            <span
              className="
                max-w-full

                text-[12px]
                font-extrabold
                leading-tight
                tracking-[-0.02em]
                text-slate-900

                transition-colors

                group-hover:text-[#235E26]

                min-[360px]:text-[13px]
                sm:text-[16px]
                md:text-[22px]
                lg:text-[28px]
                xl:text-[30px]
              "
            >
              DEPARTMENT OF AGRICULTURE - RFO1
            </span>

            {/* IDAMAG MEANING */}
            <div
              className="
                mt-0.5

                flex
                max-w-full
                flex-wrap
                items-baseline

                text-[6px]
                font-semibold
                uppercase
                leading-tight
                tracking-[0.02em]
                text-slate-500

                min-[360px]:text-[7px]
                sm:mt-1
                sm:text-[8px]
                md:text-[10px]
                lg:text-[11px]
              "
            >
              <span
                className="
                  text-[9px]
                  font-black
                  text-[#235E26]

                  sm:text-[11px]
                  md:text-[14px]
                  lg:text-[17px]
                "
              >
                I
              </span>

              <span>locos-</span>

              <span
                className="
                  text-[9px]
                  font-black
                  text-[#235E26]

                  sm:text-[11px]
                  md:text-[14px]
                  lg:text-[17px]
                "
              >
                D
              </span>

              <span>ata and&nbsp;</span>

              <span
                className="
                  text-[9px]
                  font-black
                  text-[#235E26]

                  sm:text-[11px]
                  md:text-[14px]
                  lg:text-[17px]
                "
              >
                A
              </span>

              <span>nalytics&nbsp;</span>

              <span
                className="
                  text-[9px]
                  font-black
                  text-[#235E26]

                  sm:text-[11px]
                  md:text-[14px]
                  lg:text-[17px]
                "
              >
                M
              </span>

              <span>anagement for&nbsp;</span>

              <span
                className="
                  text-[9px]
                  font-black
                  text-[#235E26]

                  sm:text-[11px]
                  md:text-[14px]
                  lg:text-[17px]
                "
              >
                A
              </span>

              <span>gricultural&nbsp;</span>

              <span
                className="
                  text-[9px]
                  font-black
                  text-[#235E26]

                  sm:text-[11px]
                  md:text-[14px]
                  lg:text-[17px]
                "
              >
                G
              </span>

              <span>ateway</span>
            </div>
          </div>
        </Link>
      </div>

      {/* RIGHT SIDE */}
      <div className="flex shrink-0 items-center">
        {isHomePage && (
          <div ref={menuRef} className="relative">
            {/* HAMBURGER BUTTON */}
            <button
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              className="
                flex
                h-9
                w-9
                items-center
                justify-center

                rounded-xl

                text-slate-700

                transition-all
                duration-300

                hover:bg-slate-100
                hover:text-[#235E26]

                active:scale-95

                sm:h-10
                sm:w-10

                md:h-11
                md:w-11
              "
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              {menuOpen ? (
                <X
                  className="h-5 w-5 sm:h-6 sm:w-6 md:h-7 md:w-7"
                  strokeWidth={2.5}
                />
              ) : (
                <Menu
                  className="h-6 w-6 sm:h-7 sm:w-7 md:h-8 md:w-8"
                  strokeWidth={3}
                />
              )}
            </button>

            {/* DROPDOWN MENU */}
            {menuOpen && (
              <div
                role="menu"
                className="
                  absolute
                  right-0
                  top-11

                  w-44

                  overflow-hidden

                  rounded-2xl

                  border
                  border-slate-200

                  bg-white

                  py-2

                  shadow-xl

                  animate-in
                  fade-in
                  zoom-in-95
                  duration-200

                  sm:top-12
                  sm:w-48

                  md:top-14
                  md:w-52
                "
              >
                <Link
                  to="/feedback"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="
                    block
                    px-4
                    py-3
                    text-sm
                    font-semibold
                    text-slate-700
                    transition-colors
                    hover:bg-[#235E26]
                    hover:text-white

                    sm:px-5
                  "
                >
                  Feedback
                </Link>

                <Link
                  to="/about"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="
                    block
                    px-4
                    py-3
                    text-sm
                    font-semibold
                    text-slate-700
                    transition-colors
                    hover:bg-[#235E26]
                    hover:text-white

                    sm:px-5
                  "
                >
                  About Us
                </Link>

                <Link
                  to="/user-guide"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="
                    block
                    px-4
                    py-3
                    text-sm
                    font-semibold
                    text-slate-700
                    transition-colors
                    hover:bg-[#235E26]
                    hover:text-white

                    sm:px-5
                  "
                >
                  User Guide
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
