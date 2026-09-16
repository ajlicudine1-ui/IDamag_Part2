import logo from "../../assets/DA-RFO1_LOGO.png";
import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Monitor,
  Navigation,
  Building2,
  FileText,
  Maximize2,
  X,
  ChevronRight,
  ChevronLeft,
  Search,
} from "lucide-react";

const idamagSteps = [
  {
    id: 1,
    title: "Open the iDAMAG Home Page",
    description:
      "Access the iDAMAG public portal and click the Explore Dashboards button to begin viewing the available dashboards.",
    image: "/iDAMAG/For Public Users/1.png",
    icon: Monitor,
  },
  {
    id: 2,
    title: "Select a Dashboard Category",
    description:
      "Choose a dashboard category such as Agricultural Production, Agricultural Programs, Administration, Farmers & Beneficiaries, Animal Health, or another available category.",
    image: "/iDAMAG/For Public Users/2.png",
    icon: Navigation,
  },
  {
    id: 3,
    title: "Select a Division or Section",
    description:
      "From the selected category, choose the division or section whose reports and dashboards you want to view.",
    image: "/iDAMAG/For Public Users/3.png",
    icon: Building2,
  },
  {
    id: 4,
    title: "Choose a Dashboard",
    description:
      "Select one of the available dashboards under the chosen division or section to open its report.",
    image: "/iDAMAG/For Public Users/4.png",
    icon: FileText,
  },
  {
    id: 5,
    title: "View the Dashboard",
    description:
      "Review the selected dashboard and explore its charts, maps, statistics, filters, and other available information.",
    image: "/iDAMAG/For Public Users/5.png",
    icon: BookOpen,
  },
];

const chatbotSteps = [
  {
    id: 1,
    title: "Open the iDAMAG Chatbot",
    description:
      "Click the chatbot button on the page to open the iDAMAG Chatbot and start asking questions about available dashboard data.",
    image: "/iDAMAG/For Public Users/6.png",
    icon: BookOpen,
  },
  {
    id: 2,
    title: "Select a Dashboard in the Chatbot",
    description:
      "Choose the dashboard you want to ask about from the list of available dashboards shown inside the chatbot.",
    image: "/iDAMAG/For Public Users/7.png",
    icon: Navigation,
  },
  {
    id: 3,
    title: "Start a Chat with the Selected Dashboard",
    description:
      "After selecting a dashboard, the chatbot connects to its available data and becomes ready to answer questions about that report.",
    image: "/iDAMAG/For Public Users/8.png",
    icon: Monitor,
  },
  {
    id: 4,
    title: "Ask a Question",
    description:
      "Type a natural-language question about the selected dashboard. You can ask about locations, associations, values, rankings, totals, or other information available in the report.",
    image: "/iDAMAG/For Public Users/9.png",
    icon: Search,
  },
  {
    id: 5,
    title: "Review the Chatbot Response",
    description:
      "Review the chatbot's answer based on the connected dashboard data, then continue asking follow-up questions when you need more information.",
    image: "/iDAMAG/For Public Users/10.png",
    icon: FileText,
  },
];

const UserGuide = () => {
  const [selectedImage, setSelectedImage] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filterGuideSteps = (steps) =>
    steps.filter(
      (step) =>
        step.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        step.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const filteredIdamagSteps = filterGuideSteps(idamagSteps);
  const filteredChatbotSteps = filterGuideSteps(chatbotSteps);

  const getSelectedSectionSteps = () => {
    if (!selectedImage) {
      return [];
    }

    return selectedImage.section === "How to Use Chatbot"
      ? chatbotSteps
      : idamagSteps;
  };

  const getSelectedStepIndex = () => {
    const sectionSteps = getSelectedSectionSteps();

    return sectionSteps.findIndex(
      (step) => step.id === selectedImage?.id
    );
  };

  const goToPreviousStep = () => {
    const sectionSteps = getSelectedSectionSteps();
    const currentIndex = getSelectedStepIndex();

    if (currentIndex <= 0) {
      return;
    }

    setSelectedImage({
      ...sectionSteps[currentIndex - 1],
      section: selectedImage.section,
    });
  };

  const goToNextStep = () => {
    const sectionSteps = getSelectedSectionSteps();
    const currentIndex = getSelectedStepIndex();

    if (
      currentIndex < 0 ||
      currentIndex >= sectionSteps.length - 1
    ) {
      return;
    }

    setSelectedImage({
      ...sectionSteps[currentIndex + 1],
      section: selectedImage.section,
    });
  };

  const selectedSectionSteps = getSelectedSectionSteps();
  const selectedStepIndex = getSelectedStepIndex();
  const hasPreviousStep = selectedStepIndex > 0;
  const hasNextStep =
    selectedStepIndex >= 0 &&
    selectedStepIndex < selectedSectionSteps.length - 1;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 py-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        
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
                        User Guide
                      </h1>
                    </div>
                  </div>

        {/* Header */}
        <div
          className="
            bg-white
            rounded-3xl
            p-8
            border
            border-slate-100
            shadow-sm
            mb-8
            relative
            overflow-hidden
          "
        >
          {/* Decorative Circle */}
          <div
            className="
              absolute
              -top-24
              -right-24
              w-64
              h-64
              bg-green-50
              rounded-full
            "
          />

          <div
            className="
              relative
              z-10
              flex
              flex-col
              md:flex-row
              md:items-center
              justify-between
              gap-4

              sm:gap-6
            "
          >
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="
                    w-10
                    h-10

                    sm:w-12
                    sm:h-12
                    rounded-2xl
                    bg-[#235E26]/10
                    flex
                    items-center
                    justify-center
                  "
                >
                  <BookOpen
                    className="text-[#235E26]"
                    size={26}
                  />
                </div>

                <div>
                  <h1 className="text-xl font-black text-slate-900 sm:text-2xl md:text-3xl">
                    ILOCOS DAMAG
                  </h1>

                  <p className="text-sm font-semibold text-[#235E26]">
                    Step-by-Step Navigation
                  </p>
                </div>
              </div>

              <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-slate-500 sm:mt-4 sm:text-base">
                Learn how to navigate iDamag and access the dashboards,
                divisions, reports, and agricultural information available
                through the system.
              </p>
            </div>

            {/* Search */}
            <div className="relative w-full md:w-80">
              <Search
                className="
                  absolute
                  left-4
                  top-1/2
                  -translate-y-1/2
                  text-slate-400
                "
                size={18}
              />

              <input
                type="text"
                placeholder="Search guide..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="
                  w-full
                  pl-11
                  pr-4
                  py-3
                  bg-slate-50
                  border
                  border-slate-200
                  rounded-2xl
                  text-sm
                  outline-none

                  focus:border-[#235E26]
                  focus:ring-4
                  focus:ring-[#235E26]/10

                  transition-all
                "
              />
            </div>
          </div>
        </div>

        {/* How to Use iDAMAG */}
        <div className="mb-6">
          <h2 className="text-xl font-black text-slate-900 sm:text-2xl">
            How to Use iDAMAG
          </h2>

          <p className="mt-1 text-sm text-slate-500 sm:text-base">
            Follow these steps to navigate the public iDAMAG portal and open a dashboard.
          </p>
        </div>

        <div
          className="
            grid
            grid-cols-1
            md:grid-cols-2
            lg:grid-cols-3
            gap-4
            sm:gap-6
          "
        >
          {filteredIdamagSteps.length > 0 ? (
            filteredIdamagSteps.map((step) => {
              const StepIcon = step.icon;

              return (
                <div
                  key={`idamag-${step.id}`}
                  className="
                    bg-white
                    rounded-3xl
                    border
                    border-slate-100
                    shadow-sm
                    overflow-hidden
                    hover:shadow-xl
                    hover:-translate-y-1
                    transition-all
                    duration-300
                    group
                  "
                >
                  <div className="relative h-44 overflow-hidden bg-slate-100 sm:h-52">
                    <img
                      src={step.image}
                      alt={step.title}
                      className="
                        w-full
                        h-full
                        object-cover
                        group-hover:scale-105
                        transition-transform
                        duration-500
                      "
                    />

                    <div
                      className="
                        absolute
                        inset-0
                        bg-black/0
                        group-hover:bg-black/10
                        transition-colors
                        flex
                        items-center
                        justify-center
                      "
                    >
                      <button
                        onClick={() =>
                          setSelectedImage({
                            ...step,
                            section: "How to Use iDAMAG",
                          })
                        }
                        className="
                          w-11
                          h-11
                          bg-white
                          rounded-xl
                          shadow-lg
                          flex
                          items-center
                          justify-center
                          text-[#235E26]
                          opacity-0
                          scale-90
                          group-hover:opacity-100
                          group-hover:scale-100
                          transition-all
                          duration-300
                        "
                        aria-label={`View ${step.title}`}
                      >
                        <Maximize2 size={20} />
                      </button>
                    </div>

                    <div
                      className="
                        absolute
                        top-4
                        left-4
                        w-10
                        h-10
                        bg-white/95
                        rounded-xl
                        shadow-sm
                        flex
                        items-center
                        justify-center
                      "
                    >
                      <StepIcon
                        size={20}
                        className="text-[#235E26]"
                      />
                    </div>
                  </div>

                  <div className="p-4 sm:p-6">
                    <div
                      className="
                        flex
                        items-center
                        gap-1
                        text-[11px]
                        font-black
                        uppercase
                        tracking-widest
                        text-[#235E26]
                        mb-3
                      "
                    >
                      Step {step.id}
                      <ChevronRight size={12} />
                    </div>

                    <h3
                      className="
                        text-lg
                        font-black
                        text-slate-800
                        mb-2
                        group-hover:text-[#235E26]
                        transition-colors
                      "
                    >
                      {step.title}
                    </h3>

                    <p className="text-sm text-slate-500 leading-relaxed font-medium">
                      {step.description}
                    </p>

                    <button
                      onClick={() =>
                        setSelectedImage({
                          ...step,
                          section: "How to Use iDAMAG",
                        })
                      }
                      className="
                        mt-5
                        inline-flex
                        items-center
                        gap-2
                        text-sm
                        font-bold
                        text-[#235E26]
                        hover:gap-3
                        transition-all
                      "
                    >
                      View Guide
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full bg-white rounded-3xl border border-dashed border-slate-200 py-10 sm:py-16 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-4">
                <Search size={30} />
              </div>

              <h3 className="text-xl font-black text-slate-900">
                No iDAMAG guide found
              </h3>

              <p className="text-slate-500 mt-2">
                No iDAMAG tutorials match "{searchQuery}".
              </p>
            </div>
          )}
        </div>

        {/* How to Use Chatbot */}
        <div className="mt-12 mb-6 sm:mt-16">
          <h2 className="text-xl font-black text-slate-900 sm:text-2xl">
            How to Use Chatbot
          </h2>

          <p className="mt-1 text-sm text-slate-500 sm:text-base">
            Follow these steps to open the chatbot, select a dashboard, ask questions, and review the answers.
          </p>
        </div>

        <div
          className="
            grid
            grid-cols-1
            md:grid-cols-2
            lg:grid-cols-3
            gap-4
            sm:gap-6
          "
        >
          {filteredChatbotSteps.length > 0 ? (
            filteredChatbotSteps.map((step) => {
              const StepIcon = step.icon;

              return (
                <div
                  key={`chatbot-${step.id}`}
                  className="
                    bg-white
                    rounded-3xl
                    border
                    border-slate-100
                    shadow-sm
                    overflow-hidden
                    hover:shadow-xl
                    hover:-translate-y-1
                    transition-all
                    duration-300
                    group
                  "
                >
                  <div className="relative h-44 overflow-hidden bg-slate-100 sm:h-52">
                    <img
                      src={step.image}
                      alt={step.title}
                      className="
                        w-full
                        h-full
                        object-cover
                        group-hover:scale-105
                        transition-transform
                        duration-500
                      "
                    />

                    <div
                      className="
                        absolute
                        inset-0
                        bg-black/0
                        group-hover:bg-black/10
                        transition-colors
                        flex
                        items-center
                        justify-center
                      "
                    >
                      <button
                        onClick={() =>
                          setSelectedImage({
                            ...step,
                            section: "How to Use Chatbot",
                          })
                        }
                        className="
                          w-11
                          h-11
                          bg-white
                          rounded-xl
                          shadow-lg
                          flex
                          items-center
                          justify-center
                          text-[#235E26]
                          opacity-0
                          scale-90
                          group-hover:opacity-100
                          group-hover:scale-100
                          transition-all
                          duration-300
                        "
                        aria-label={`View ${step.title}`}
                      >
                        <Maximize2 size={20} />
                      </button>
                    </div>

                    <div
                      className="
                        absolute
                        top-4
                        left-4
                        w-10
                        h-10
                        bg-white/95
                        rounded-xl
                        shadow-sm
                        flex
                        items-center
                        justify-center
                      "
                    >
                      <StepIcon
                        size={20}
                        className="text-[#235E26]"
                      />
                    </div>
                  </div>

                  <div className="p-4 sm:p-6">
                    <div
                      className="
                        flex
                        items-center
                        gap-1
                        text-[11px]
                        font-black
                        uppercase
                        tracking-widest
                        text-[#235E26]
                        mb-3
                      "
                    >
                      Step {step.id}
                      <ChevronRight size={12} />
                    </div>

                    <h3
                      className="
                        text-lg
                        font-black
                        text-slate-800
                        mb-2
                        group-hover:text-[#235E26]
                        transition-colors
                      "
                    >
                      {step.title}
                    </h3>

                    <p className="text-sm text-slate-500 leading-relaxed font-medium">
                      {step.description}
                    </p>

                    <button
                      onClick={() =>
                        setSelectedImage({
                          ...step,
                          section: "How to Use Chatbot",
                        })
                      }
                      className="
                        mt-5
                        inline-flex
                        items-center
                        gap-2
                        text-sm
                        font-bold
                        text-[#235E26]
                        hover:gap-3
                        transition-all
                      "
                    >
                      View Guide
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full bg-white rounded-3xl border border-dashed border-slate-200 py-10 sm:py-16 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-4">
                <Search size={30} />
              </div>

              <h3 className="text-xl font-black text-slate-900">
                No chatbot guide found
              </h3>

              <p className="text-slate-500 mt-2">
                No chatbot tutorials match "{searchQuery}".
              </p>
            </div>
          )}
        </div>
      </main>

      {/* IMAGE MODAL */}
      {selectedImage && (
        <div
          className="
            fixed
            inset-0
            z-[99999]
            flex
            items-center
            justify-center
            p-4
            md:p-8
          "
        >
          {/* Background */}
          <div
            className="
              absolute
              inset-0
              bg-slate-900/70
              backdrop-blur-sm
            "
            onClick={() => setSelectedImage(null)}
          />

          {/* Modal */}
          <div
            className="
              relative
              z-10

              bg-white
              rounded-3xl
              shadow-2xl

              max-w-6xl
              w-full
              max-h-[90vh]

              overflow-y-auto
              p-5
              md:p-7
            "
          >
            {/* Close */}
            <button
              onClick={() => setSelectedImage(null)}
              className="
                absolute
                top-5
                right-5

                w-10
                h-10

                rounded-full
                bg-white
                border
                border-slate-200
                shadow-md

                flex
                items-center
                justify-center

                text-slate-600
                hover:text-red-500
                hover:scale-105

                transition-all
                z-20
              "
            >
              <X size={22} />
            </button>

            {/* Modal Header */}
            <div className="pr-14 mb-6">
              <div className="flex items-center gap-3">
                <div
                  className="
                    w-12
                    h-12
                    rounded-2xl
                    bg-[#235E26]/10

                    flex
                    items-center
                    justify-center
                  "
                >
                  {React.createElement(selectedImage.icon, {
                    size: 24,
                    className: "text-[#235E26]",
                  })}
                </div>

                <div>
                  <div
                    className="
                      text-xs
                      uppercase
                      tracking-widest
                      font-black
                      text-[#235E26]
                    "
                  >
                    {selectedImage.section} • Step {selectedImage.id}
                  </div>

                  <h2 className="text-xl font-black text-slate-900 sm:text-2xl">
                    {selectedImage.title}
                  </h2>
                </div>
              </div>
            </div>

            {/* Large Image */}
            <img
              src={selectedImage.image}
              alt={selectedImage.title}
              className="
                w-full
                rounded-2xl
                border
                border-slate-200
              "
            />

            {/* Previous / Next Navigation */}
            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={goToPreviousStep}
                disabled={!hasPreviousStep}
                className={`
                  inline-flex
                  items-center
                  gap-2
                  rounded-xl
                  border
                  px-4
                  py-2.5
                  text-sm
                  font-bold
                  transition-all
                  ${
                    hasPreviousStep
                      ? "border-slate-200 bg-white text-slate-700 hover:border-[#235E26] hover:text-[#235E26] hover:shadow-sm"
                      : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                  }
                `}
              >
                <ChevronLeft size={18} />
                Previous
              </button>

              <div className="text-center text-xs font-bold text-slate-400 sm:text-sm">
                Step {selectedImage.id} of {selectedSectionSteps.length}
              </div>

              <button
                type="button"
                onClick={goToNextStep}
                disabled={!hasNextStep}
                className={`
                  inline-flex
                  items-center
                  gap-2
                  rounded-xl
                  border
                  px-4
                  py-2.5
                  text-sm
                  font-bold
                  transition-all
                  ${
                    hasNextStep
                      ? "border-[#235E26] bg-[#235E26] text-white hover:bg-[#1d4f20] hover:shadow-sm"
                      : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                  }
                `}
              >
                Next
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Instructions */}
            <div
              className="
                mt-6
                bg-slate-50
                border
                border-slate-100
                rounded-2xl
                p-4

                sm:p-6
              "
            >
              <h3
                className="
                  text-sm
                  font-black
                  uppercase
                  tracking-wide
                  text-[#235E26]
                  mb-2
                "
              >
                Instructions
              </h3>

              <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
                {selectedImage.description}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserGuide;