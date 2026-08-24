import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  Database,
  LayoutDashboard,
  Loader2,
  CalendarDays,
  MapPin,
  Presentation,
  PanelsTopLeft,
} from "lucide-react";

import logo from "../../assets/DA-RFO1_LOGO.png";

import { getOffices } from "../../constants/offices";
import {
  getDivisions,
  getReports,
} from "../../services/api";

const About = () => {
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // =====================================================
  // LOAD ALL DASHBOARDS
  // =====================================================

  useEffect(() => {
    let isMounted = true;

    const loadDashboards = async () => {
      try {
        setLoading(true);
        setError("");

        // Get all top-level offices/categories
        const officesResponse = await getOffices();

        const officeList = Array.isArray(officesResponse)
          ? officesResponse
          : [];

        const allDashboards = [];

        // Go through every office/category
        for (const office of officeList) {
          try {
            const divisionsResponse =
              await getDivisions(office.id);

            const divisions = Array.isArray(
              divisionsResponse?.data
            )
              ? divisionsResponse.data
              : Array.isArray(divisionsResponse)
                ? divisionsResponse
                : [];

            // Go through sections/divisions
            for (const division of divisions) {
              try {
                const reportsResponse =
                  await getReports({
                    divisionId: division.id,
                  });

                const reports = Array.isArray(
                  reportsResponse?.data
                )
                  ? reportsResponse.data
                  : Array.isArray(reportsResponse)
                    ? reportsResponse
                    : [];

                reports.forEach((report) => {
                  allDashboards.push({
                    ...report,

                    officeName:
                      office.name ||
                      "DA-RFO I",

                    officeAcronym:
                      office.acronym ||
                      "",

                    divisionName:
                      division.name ||
                      "",
                  });
                });
              } catch (reportError) {
                console.error(
                  `Unable to load reports for division ${division.id}:`,
                  reportError
                );
              }
            }
          } catch (divisionError) {
            console.error(
              `Unable to load divisions for office ${office.id}:`,
              divisionError
            );
          }
        }

        // Remove duplicate reports
        const uniqueDashboards =
          allDashboards.filter(
            (dashboard, index, array) =>
              index ===
              array.findIndex(
                (item) =>
                  String(item.id) ===
                  String(dashboard.id)
              )
          );

        if (isMounted) {
          setDashboards(uniqueDashboards);
        }
      } catch (err) {
        console.error(
          "Unable to load dashboards:",
          err
        );

        if (isMounted) {
          setError(
            "Unable to load the available dashboards."
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadDashboards();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <main className="px-4 pb-16 pt-6 md:px-8">
        <div className="mx-auto w-full max-w-7xl">

          {/* =================================================
              PAGE HEADER
          ================================================= */}

           <div className="relative mb-8">
          
                    {/* Back to Home - KEEP THIS */}
                      <Link
                         to="/"
                        className="absolute left-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-2 text-slate-500 hover:text-green-700 text-sm font-semibold transition-colors"
                       >
                        <ArrowLeft className="w-5 h-5" />
                        <span className="hidden sm:inline">Back to Home</span>
                      </Link>

            {/* PAGE TITLE */}
            <div
              className="
                flex
                items-center
                justify-center
                gap-4
              "
            >
              <img
                src={logo}
                alt="Department of Agriculture Logo"
                className="
                  h-14
                  w-14
                  object-contain

                  md:h-16
                  md:w-16
                "
              />

              <h1
                className="
                  text-2xl
                  font-black
                  tracking-tight
                  text-slate-900

                  sm:text-3xl
                  md:text-4xl
                  lg:text-5xl
                "
              >
                ABOUT
              </h1>
            </div>
          </div>

          {/* =================================================
              ABOUT HERO CARD
          ================================================= */}

          <section
            className="
              relative
              overflow-hidden

              rounded-[32px]

              border
              border-[#D7E7D5]

              bg-white

              px-6
              py-8

              shadow-xl

              md:px-10
              md:py-12

              lg:px-14
              lg:py-14
            "
          >
            {/* DECORATIVE CIRCLES */}

            <div
              className="
                pointer-events-none
                absolute
                -right-20
                -top-20

                h-64
                w-64

                rounded-full

                bg-[#235E26]/5
              "
            />

            <div
              className="
                pointer-events-none
                absolute
                -bottom-24
                -left-20

                h-64
                w-64

                rounded-full

                bg-[#235E26]/5
              "
            />

            <div
              className="
                relative
                z-10

                grid
                items-center
                gap-4

                sm:gap-8

                lg:grid-cols-[260px_1fr]
                lg:gap-12
              "
            >
              {/* =================================================
                  LOGO SIDE
              ================================================= */}

              <div
                className="
                  hidden
                  items-center
                  justify-center

                  sm:flex
                "
              >
                <div
                  className="
                    flex
                    h-48
                    w-48
                    items-center
                    justify-center

                    rounded-[32px]

                    bg-white

                    p-6

                    

                    md:h-70
                    md:w-70
                  "
                >
                  <img
                    src={logo}
                    alt="DA-RFO I"
                    className="
                      h-full
                      w-full
                      object-contain
                    "
                  />
                </div>
              </div>

              {/* =================================================
                  CONTENT SIDE
              ================================================= */}

              <div className="text-center sm:text-left">


                {/* I-DAMAG TITLE */}
                <h2
                  className="
                    mt-5

                    text-center
                    text-3xl
                    font-black
                    tracking-tight

                    text-[#235E26]

                    sm:text-left
                    sm:text-4xl
                    md:text-5xl
                    lg:text-6xl
                  "
                >
                  I-DAMAG
                </h2>

                {/* =================================================
                    FULL MEANING
                ================================================= */}

                <div
                  className="
                    mt-3

                    flex
                    flex-nowrap
                    items-baseline
                    justify-center

                    overflow-hidden

                    whitespace-nowrap

                    text-[8px]
                    font-semibold
                    uppercase
                    tracking-tight

                    text-slate-800

                    sm:justify-start
                    sm:text-[10px]

                    md:text-xs
                    lg:text-sm
                    xl:text-base
                  "
                >
                  <span
                    className="
                      text-[10px]
                      font-black
                      text-[#235E26]

                      sm:text-xs
                      md:text-sm
                      lg:text-lg
                      xl:text-xl
                    "
                  >
                    I
                  </span>
                  <span>locos-</span>

                  <span
                    className="
                      text-[10px]
                      font-black
                      text-[#235E26]

                      sm:text-xs
                      md:text-sm
                      lg:text-lg
                      xl:text-xl
                    "
                  >
                    D
                  </span>
                  <span>ata and&nbsp;</span>

                  <span
                    className="
                      text-[10px]
                      font-black
                      text-[#235E26]

                      sm:text-xs
                      md:text-sm
                      lg:text-lg
                      xl:text-xl
                    "
                  >
                    A
                  </span>
                  <span>nalytics&nbsp;</span>

                  <span
                    className="
                      text-[10px]
                      font-black
                      text-[#235E26]

                      sm:text-xs
                      md:text-sm
                      lg:text-lg
                      xl:text-xl
                    "
                  >
                    M
                  </span>
                  <span>anagement for&nbsp;</span>

                  <span
                    className="
                      text-[10px]
                      font-black
                      text-[#235E26]

                      sm:text-xs
                      md:text-sm
                      lg:text-lg
                      xl:text-xl
                    "
                  >
                    A
                  </span>
                  <span>gricultural&nbsp;</span>

                  <span
                    className="
                      text-[10px]
                      font-black
                      text-[#235E26]

                      sm:text-xs
                      md:text-sm
                      lg:text-lg
                      xl:text-xl
                    "
                  >
                    
                  </span>
                  <span>ateway</span>
                </div>

                {/* =================================================
                      DESCRIPTION
                  ================================================= */}

                  <p
                    className="
                      mt-6

                      max-w-4xl

                      text-justify

                      text-[15px]
                      leading-8

                      text-slate-800

                      sm:text-base
                      sm:leading-8

                      md:text-[17px]
                      md:leading-8
                    "
                  >
                    I-DAMAG is a centralized data and analytics platform of the
                    Department of Agriculture - Regional Field Office I. It
                    provides a unified gateway for accessing and visualizing
                    agricultural data, reports, and interactive dashboards from
                    the different divisions and sections of DA-RFO I.
                  </p>

                  <p
                    className="
                      mt-5

                      max-w-4xl

                      text-justify

                      text-[15px]
                      leading-8

                      text-slate-700

                      sm:text-base
                      sm:leading-8

                      md:text-[17px]
                      md:leading-8
                    "
                  >
                    The system is designed to make agricultural information
                    more accessible, organized, and easier to understand
                    through interactive dashboards and data-driven reports.
                  </p>

                {/* =================================================
                    FEATURES
                ================================================= */}

                <div
                  className="
                    mt-8

                    grid
                    gap-3

                    sm:grid-cols-3
                  "
                >
                  {/* CENTRALIZED DATA */}
                  <div
                    className="
                      flex
                      items-center
                      gap-3

                      rounded-2xl

                      border
                      border-[#D7E7D5]

                      bg-[#F7FAF6]

                      px-4
                      py-3
                    "
                  >
                    <Database
                      className="
                        h-5
                        w-5
                        shrink-0

                        text-[#235E26]
                      "
                    />

                    <span
                      className="
                        text-xs
                        font-semibold

                        text-slate-800
                      "
                    >
                      Centralized Data
                    </span>
                  </div>

                  {/* DATA ANALYTICS */}
                  <div
                    className="
                      flex
                      items-center
                      gap-3

                      rounded-2xl

                      border
                      border-[#D7E7D5]

                      bg-[#F7FAF6]

                      px-4
                      py-3
                    "
                  >
                    <BarChart3
                      className="
                        h-5
                        w-5
                        shrink-0

                        text-[#235E26]
                      "
                    />

                    <span
                      className="
                        text-xs
                        font-semibold

                        text-slate-800
                      "
                    >
                      Data Analytics
                    </span>
                  </div>

                  {/* INTERACTIVE DASHBOARDS */}
                  <div
                    className="
                      flex
                      items-center
                      gap-3

                      rounded-2xl

                      border
                      border-[#D7E7D5]

                      bg-[#F7FAF6]

                      px-4
                      py-3
                    "
                  >
                    <LayoutDashboard
                      className="
                        h-5
                        w-5
                        shrink-0

                        text-[#235E26]
                      "
                    />

                    <span
                      className="
                        text-xs
                        font-semibold

                        text-slate-800
                      "
                    >
                      Interactive Dashboards
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* =================================================
              HOW I-DAMAG STARTED - SEPARATE CARD
          ================================================= */}

          <section className="mt-10">
            <div className="mb-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[#235E26]">
                Our Beginning
              </p>

              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                How I-DAMAG Started
              </h2>
            </div>

            <div
              className="
                relative
                overflow-hidden
                rounded-[32px]
                border
                border-[#D7E7D5]
                bg-white
                px-6
                py-8
                shadow-xl
                md:px-10
                md:py-10
                lg:px-12
                lg:py-12
              "
            >
              <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#235E26]/5" />

              <div className="relative z-10">
                <p className="text-justify text-[15px] leading-8 text-slate-700 sm:text-base">
                  The development of{" "}
                  <span className="font-bold text-[#235E26]">
                    I-DAMAG
                  </span>{" "}
                  traces its beginnings to the{" "}
                  <span className="font-semibold text-slate-900">
                    Data Warehousing and Visualization Using Microsoft Power BI
                    Workshop and Training
                  </span>
                  , attended by personnel from the Department of Agriculture -
                  Regional Field Office I in{" "}
                  <span className="font-semibold text-slate-900">
                    Baguio City on April 21-24, 2026
                  </span>
                  .
                </p>

                <p className="mt-5 text-justify text-[15px] leading-8 text-slate-700 sm:text-base">
                  The training strengthened participants' knowledge and skills
                  in organizing, analyzing, and transforming data into
                  meaningful and interactive visualizations using Microsoft
                  Power BI. Following the training, different offices,
                  divisions, and sections of DA-RFO I developed dashboards to
                  present and monitor their respective data and information
                  more effectively.
                </p>

                <p className="mt-5 text-justify text-[15px] leading-8 text-slate-700 sm:text-base">
                  As the number of dashboards increased, the need for a
                  centralized platform became evident. This led to the
                  development of{" "}
                  <span className="font-bold text-[#235E26]">
                    I-DAMAG - Ilocos-Data and Analytics Management for
                    Agricultural Gateway
                  </span>
                  , a web-based platform that brings these dashboards together
                  in one accessible location.
                </p>

                <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-2xl border border-[#D7E7D5] bg-[#F7FAF6] p-4">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF4E8]">
                      <CalendarDays className="h-5 w-5 text-[#235E26]" />
                    </div>

                    <p className="text-xs font-black uppercase tracking-wider text-[#235E26]">
                      April 21-24, 2026
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Data warehousing and Power BI workshop and training.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#D7E7D5] bg-[#F7FAF6] p-4">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF4E8]">
                      <MapPin className="h-5 w-5 text-[#235E26]" />
                    </div>

                    <p className="text-xs font-black uppercase tracking-wider text-[#235E26]">
                      Baguio City
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      The workshop became the starting point for the initiative.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#D7E7D5] bg-[#F7FAF6] p-4">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF4E8]">
                      <Presentation className="h-5 w-5 text-[#235E26]" />
                    </div>

                    <p className="text-xs font-black uppercase tracking-wider text-[#235E26]">
                      Dashboard Development
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      DA-RFO I offices and sections developed interactive Power
                      BI dashboards.
                    </p>
                  </div>



                  <div className="rounded-2xl border border-[#D7E7D5] bg-[#F7FAF6] p-4">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF4E8]">
                      <PanelsTopLeft className="h-5 w-5 text-[#235E26]" />
                    </div>

                    <p className="text-xs font-black uppercase tracking-wider text-[#235E26]">
                      I-DAMAG
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      One centralized website linking the dashboards of DA-RFO
                      I.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* =================================================
              AVAILABLE DASHBOARDS
          ================================================= */}

          <section className="mt-12">

            {/* SECTION TITLE */}
            <div className="mb-8">
              <h2
                className="
                  text-2xl
                  font-black
                  tracking-tight

                  text-slate-900

                  md:text-3xl
                "
              >
                Available Dashboards
              </h2>

              <p
                className="
                  mt-2

                  max-w-3xl

                  text-sm
                  leading-6

                  text-slate-600
                "
              >
                Explore the dashboards and reports
                available from the different divisions
                and sections of the Department of
                Agriculture - Regional Field Office I.
              </p>
            </div>

            {/* =================================================
                LOADING
            ================================================= */}

            {loading && (
              <div
                className="
                  flex
                  min-h-[220px]
                  flex-col
                  items-center
                  justify-center

                  rounded-3xl

                  border
                  border-slate-200

                  bg-white
                "
              >
                <Loader2
                  className="
                    h-8
                    w-8

                    animate-spin

                    text-[#235E26]
                  "
                />

                <p
                  className="
                    mt-4

                    text-sm
                    text-slate-500
                  "
                >
                  Loading available dashboards...
                </p>
              </div>
            )}

            {/* =================================================
                ERROR
            ================================================= */}

            {!loading && error && (
              <div
                className="
                  rounded-3xl

                  border
                  border-red-200

                  bg-red-50

                  px-6
                  py-10

                  text-center
                "
              >
                <p className="font-semibold text-red-700">
                  {error}
                </p>
              </div>
            )}

            {/* =================================================
                DASHBOARD CARDS
            ================================================= */}

            {!loading &&
              !error &&
              dashboards.length > 0 && (
                <div
                  className="
                    grid
                    grid-cols-1

                    gap-4

                    sm:grid-cols-2
                    lg:grid-cols-3
                    xl:grid-cols-4
                  "
                >
                  {dashboards.map(
                    (dashboard) => (
                      <div
                        key={dashboard.id}
                        className="
                          group
                          relative

                          overflow-hidden

                          rounded-2xl

                          border
                          border-[#D7E7D5]

                          bg-white

                          p-5

                          shadow-sm

                          transition-all
                          duration-300

                          hover:-translate-y-1
                          hover:border-[#235E26]
                          hover:shadow-lg
                        "
                      >
                        {/* GREEN TOP LINE */}
                        <div
                          className="
                            absolute
                            left-0
                            top-0

                            h-1
                            w-full

                            bg-[#235E26]
                          "
                        />

                        {/* ICON */}
                        <div
                          className="
                            mb-4

                            flex
                            h-11
                            w-11
                            items-center
                            justify-center

                            rounded-xl

                            bg-[#EAF4E8]

                            transition-colors

                            group-hover:bg-[#235E26]
                          "
                        >
                          <LayoutDashboard
                            className="
                              h-5
                              w-5

                              text-[#235E26]

                              transition-colors

                              group-hover:text-white
                            "
                          />
                        </div>

                        {/* DASHBOARD TITLE */}
                        <h3
                          className="
                            text-base
                            font-bold
                            leading-snug

                            text-slate-900
                          "
                        >
                          {dashboard.title ||
                            "Untitled Dashboard"}
                        </h3>

                        {/* DESCRIPTION */}
                        {dashboard.description && (
                          <p
                            className="
                              mt-2

                              line-clamp-2

                              text-xs
                              leading-5

                              text-slate-600
                            "
                          >
                            {dashboard.description}
                          </p>
                        )}

                        {/* OFFICE / DIVISION */}
                        <div
                          className="
                            mt-5

                            border-t
                            border-slate-100

                            pt-3
                          "
                        >
                          {dashboard.officeAcronym && (
                            <p
                              className="
                                text-[10px]
                                font-black
                                uppercase
                                tracking-wider

                                text-[#235E26]
                              "
                            >
                              {dashboard.officeAcronym}
                            </p>
                          )}

                          <p
                            className="
                              mt-1

                              text-[11px]
                              leading-4

                              text-slate-500
                            "
                          >
                            {dashboard.divisionName}
                          </p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

            {/* =================================================
                NO DASHBOARDS
            ================================================= */}

            {!loading &&
              !error &&
              dashboards.length === 0 && (
                <div
                  className="
                    rounded-3xl

                    border
                    border-dashed
                    border-slate-300

                    bg-white

                    px-6
                    py-16

                    text-center
                  "
                >
                  <LayoutDashboard
                    className="
                      mx-auto

                      h-10
                      w-10

                      text-slate-300
                    "
                  />

                  <h3
                    className="
                      mt-4

                      font-bold

                      text-slate-800
                    "
                  >
                    No dashboards available
                  </h3>

                  <p
                    className="
                      mt-2

                      text-sm

                      text-slate-500
                    "
                  >
                    Dashboard names will appear here
                    once reports are available.
                  </p>
                </div>
              )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default About;