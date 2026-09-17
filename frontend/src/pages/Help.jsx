import React, { useState } from "react";
import ManagementLayout from "../components/management/ManagementLayout";
import {
  BookOpen,
  UserCircle,
  Settings,
  Monitor,
  ChevronRight,
  ChevronLeft,
  Maximize2,
  X,
  FileText,
  Users as UsersIcon,
  Building2,
  Lock,
  Search,
} from "lucide-react";

function LayoutDashboardIcon(props) {
  return <Monitor {...props} />;
}

function FilePlusIcon(props) {
  return <FileText {...props} />;
}

function EditIcon(props) {
  return <Settings {...props} />;
}

function UserPlusIcon(props) {
  return <UserCircle {...props} />;
}

function Edit3Icon(props) {
  return <Settings {...props} />;
}

const managementSteps = [
  {
    id: 1,
    title: "Login to the Management Portal",
    description:
      "Enter your authorized email address and password to access the iDAMAG management portal.",
    image: "/iDAMAG/For Management Users/1.png",
    icon: Lock,
    section: "getting-started",
  },
  {
    id: 2,
    title: "Open Reports Management",
    description:
      "Use the Reports page to view the available Power BI reports and manage existing dashboard entries.",
    image: "/iDAMAG/For Management Users/2.png",
    icon: LayoutDashboardIcon,
    section: "reports",
  },
  {
    id: 3,
    title: "Add a New Power BI Report",
    description:
      "Click Add New Report, enter the report title, paste the Power BI report URL, add an optional description, then save the report.",
    image: "/iDAMAG/For Management Users/3.png",
    icon: FilePlusIcon,
    section: "reports",
  },
  {
    id: 4,
    title: "Edit a Power BI Report",
    description:
      "Open an existing report for editing, update its title, Power BI report URL, or description, then save the changes.",
    image: "/iDAMAG/For Management Users/4.png",
    icon: EditIcon,
    section: "reports",
  },
  {
    id: 5,
    title: "Add Worksheets to a Report",
    description:
      "Add worksheet details for the selected Power BI report by entering the worksheet name and its connected Google Sheet URL, then save the worksheets.",
    image: "/iDAMAG/For Management Users/5.png",
    icon: FileText,
    section: "reports",
  },
  {
    id: 6,
    title: "Open User Management",
    description:
      "Use User Management to view system users, their assigned sections, roles, and account status.",
    image: "/iDAMAG/For Management Users/6.png",
    icon: UsersIcon,
    section: "users",
  },
  {
    id: 7,
    title: "Create a User Account",
    description:
      "Click Create New User, complete the required account information, assign the user's office or section and system role, then create the account.",
    image: "/iDAMAG/For Management Users/7.png",
    icon: UserPlusIcon,
    section: "users",
  },
  {
    id: 8,
    title: "Edit a User Account",
    description:
      "Open a user's account to update profile information, assigned office or section, and system role, then save the changes.",
    image: "/iDAMAG/For Management Users/8.png",
    icon: Edit3Icon,
    section: "users",
  },
  {
    id: 9,
    title: "Open Office Management",
    description:
      "Use Office Management to view and maintain the offices configured in the iDAMAG management portal.",
    image: "/iDAMAG/For Management Users/9.png",
    icon: Building2,
    section: "offices-sections",
  },
  {
    id: 10,
    title: "Add a New Office",
    description:
      "Click Add New Office, enter the office name and acronym, then save the new office.",
    image: "/iDAMAG/For Management Users/10.png",
    icon: Building2,
    section: "offices-sections",
  },
  {
    id: 11,
    title: "Edit an Office",
    description:
      "Open an existing office for editing, update its office name or acronym, then save the changes.",
    image: "/iDAMAG/For Management Users/11.png",
    icon: EditIcon,
    section: "offices-sections",
  },
  {
    id: 12,
    title: "View and Manage Sections",
    description:
      "Switch to the Sections tab to view all sections, their acronyms, and their parent offices.",
    image: "/iDAMAG/For Management Users/12.png",
    icon: Settings,
    section: "offices-sections",
  },
  {
    id: 13,
    title: "Add a New Section",
    description:
      "Click Add New Section, select the parent office, enter the section name and acronym, then save the section.",
    image: "/iDAMAG/For Management Users/13.png",
    icon: Settings,
    section: "offices-sections",
  },
  {
    id: 14,
    title: "Edit a Section",
    description:
      "Open an existing section for editing, update its parent office, section name, or acronym, then save the changes.",
    image: "/iDAMAG/For Management Users/14.png",
    icon: Edit3Icon,
    section: "offices-sections",
  },
];

const guideSections = [
  {
    id: "getting-started",
    title: "Getting Started",
    description: "Start by logging in to the iDAMAG administration portal.",
    icon: Lock,
  },
  {
    id: "reports",
    title: "How to Manage Reports",
    description:
      "Learn how to view, add, edit, and connect worksheets to Power BI reports.",
    icon: LayoutDashboardIcon,
  },
  {
    id: "users",
    title: "How to Manage Users",
    description:
      "Learn how to open user management, create user accounts, and update user details.",
    icon: UsersIcon,
  },
  {
    id: "offices-sections",
    title: "How to Manage Offices and Sections",
    description:
      "Learn how to maintain offices, view sections, and add or edit section records.",
    icon: Building2,
  },
];

function Help() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSteps = managementSteps.filter(
    (step) =>
      step.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      step.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const visibleSections = guideSections
    .map((section) => ({
      ...section,
      steps: filteredSteps.filter((step) => step.section === section.id),
    }))
    .filter((section) => section.steps.length > 0);

  const selectedStepIndex = selectedImage
    ? managementSteps.findIndex((step) => step.id === selectedImage.id)
    : -1;

  const hasPreviousStep = selectedStepIndex > 0;
  const hasNextStep =
    selectedStepIndex >= 0 &&
    selectedStepIndex < managementSteps.length - 1;

  const goToPreviousStep = () => {
    if (!hasPreviousStep) return;
    setSelectedImage(managementSteps[selectedStepIndex - 1]);
  };

  const goToNextStep = () => {
    if (!hasNextStep) return;
    setSelectedImage(managementSteps[selectedStepIndex + 1]);
  };

  const selectedSection = selectedImage
    ? guideSections.find((section) => section.id === selectedImage.section)
    : null;

  return (
    <ManagementLayout title="System Help Guide">
      <div className="space-y-8 animate-in fade-in duration-700">
        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-moss-50 rounded-full -translate-y-1/2 translate-x-1/2 opacity-50 group-hover:scale-110 transition-transform duration-700" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl font-black text-slate-900 mb-2 flex items-center gap-3">
                <BookOpen className="text-moss-600" size={32} />
                Administrator User Guide
              </h1>

              <p className="text-slate-500 font-medium">
                This guide is divided into sections so administrators can easily follow the steps for reports, users, offices, and sections.
              </p>
            </div>

            <div className="relative w-full md:w-80">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                size={18}
              />

              <input
                type="text"
                placeholder="Search tutorials..."
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
                  focus:ring-4
                  focus:ring-moss-600/10
                  focus:border-moss-600
                  outline-none
                  transition-all
                "
              />
            </div>
          </div>
        </div>

        <div className="flex p-1.5 bg-slate-100/50 rounded-2xl w-fit">
          <div
            className="
              flex
              items-center
              gap-2
              px-6
              py-3
              rounded-[1.25rem]
              text-sm
              font-black
              bg-white
              text-moss-600
              shadow-sm
            "
          >
            <Settings size={18} />
            Administrator Guide
          </div>
        </div>

        {visibleSections.length > 0 ? (
          visibleSections.map((section) => {
            const SectionIcon = section.icon;

            return (
              <section key={section.id} className="space-y-5">
                <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-moss-50 flex items-center justify-center shrink-0">
                      <SectionIcon size={22} className="text-moss-600" />
                    </div>

                    <div>
                      <h2 className="text-2xl font-black text-slate-900 mb-1">
                        {section.title}
                      </h2>
                      <p className="text-slate-500 font-medium">
                        {section.description}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {section.steps.map((step, index) => {
                    const StepIcon = step.icon;

                    return (
                      <div
                        key={step.id}
                        className="
                          bg-white
                          rounded-3xl
                          border
                          border-slate-100
                          shadow-sm
                          hover:shadow-xl
                          hover:shadow-slate-200/50
                          transition-all
                          duration-500
                          overflow-hidden
                          flex
                          flex-col
                          group
                          animate-in
                          slide-in-from-bottom-4
                        "
                        style={{
                          animationDelay: `${index * 100}ms`,
                        }}
                      >
                        <div className="relative h-48 bg-slate-50 overflow-hidden">
                          <img
                            src={step.image}
                            alt={step.title}
                            className="
                              w-full
                              h-full
                              object-cover
                              group-hover:scale-105
                              transition-transform
                              duration-700
                            "
                          />

                          <div
                            className="
                              absolute
                              inset-0
                              bg-slate-900/0
                              group-hover:bg-slate-900/10
                              transition-colors
                              duration-500
                              flex
                              items-center
                              justify-center
                            "
                          >
                            <button
                              onClick={() => setSelectedImage(step)}
                              className="
                                p-3
                                bg-white/90
                                backdrop-blur-sm
                                rounded-xl
                                shadow-lg
                                opacity-0
                                group-hover:opacity-100
                                translate-y-4
                                group-hover:translate-y-0
                                transition-all
                                duration-500
                                text-moss-600
                              "
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
                              bg-white/90
                              backdrop-blur-sm
                              rounded-xl
                              flex
                              items-center
                              justify-center
                              shadow-sm
                            "
                          >
                            <StepIcon size={20} className="text-moss-600" />
                          </div>
                        </div>

                        <div className="p-6 flex-grow flex flex-col">
                          <div className="flex items-center gap-2 text-[10px] font-black text-moss-600 uppercase tracking-widest mb-3">
                            Step {step.id}
                            <ChevronRight size={10} />
                            <span>{section.title}</span>
                          </div>

                          <h3 className="text-lg font-black text-slate-800 mb-2 group-hover:text-moss-600 transition-colors">
                            {step.title}
                          </h3>

                          <p className="text-sm text-slate-500 leading-relaxed font-medium line-clamp-2">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        ) : (
          <div
            className="
              py-20
              bg-white
              rounded-[3rem]
              border
              border-dashed
              border-slate-200
              flex
              flex-col
              items-center
              justify-center
              text-center
              animate-in
              fade-in
              zoom-in
              duration-500
            "
          >
            <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-6 text-slate-300">
              <Search size={40} />
            </div>

            <h3 className="text-xl font-black text-slate-900 mb-2">
              No results found
            </h3>

            <p className="text-slate-500 max-w-xs font-medium">
              We couldn't find any tutorials matching "{searchQuery}". Try different keywords.
            </p>

            <button
              onClick={() => setSearchQuery("")}
              className="mt-6 text-moss-600 font-black text-sm hover:underline"
            >
              Clear search
            </button>
          </div>
        )}

        <div className="bg-moss-600 rounded-3xl p-10 text-white relative overflow-hidden">
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-white/10 rounded-full translate-y-1/2 translate-x-1/4" />

          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
            <div>
              <h2 className="text-2xl font-black mb-2">Still need assistance?</h2>
              <p className="text-moss-100 font-medium">
                Our technical support team is available during office hours.
              </p>
            </div>

            <a
              href="mailto:emailsupport@darfoi.gov.ph"
              className="
                px-8
                py-4
                bg-white
                text-moss-600
                rounded-2xl
                font-black
                shadow-xl
                shadow-black/10
                hover:scale-105
                transition-all
                active:scale-95
              "
            >
              Contact Support
            </a>
          </div>
        </div>
      </div>

      {selectedImage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-10">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300"
            onClick={() => setSelectedImage(null)}
          />

          <div
            className="
              relative
              bg-white
              rounded-[2.5rem]
              p-3
              md:p-6
              shadow-2xl
              max-w-6xl
              w-full
              max-h-[calc(100vh-2rem)]
              md:max-h-[calc(100vh-5rem)]
              overflow-hidden
              flex
              flex-col
              animate-in
              zoom-in-95
              duration-300
            "
          >
            <button
              onClick={() => setSelectedImage(null)}
              className="
                absolute
                top-6
                right-6
                p-2
                bg-white
                rounded-full
                shadow-lg
                text-slate-500
                hover:text-slate-800
                z-10
                transition-colors
              "
            >
              <X size={24} />
            </button>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2 custom-scrollbar">
              <div className="mb-6 flex items-center gap-4">
                <div className="w-12 h-12 bg-moss-50 rounded-2xl flex items-center justify-center">
                  {React.createElement(selectedImage.icon, {
                    className: "text-moss-600",
                    size: 24,
                  })}
                </div>

                <div>
                  <h2 className="text-2xl font-black text-slate-900 leading-tight">
                    {selectedImage.title}
                  </h2>

                  <p className="text-slate-500 font-bold text-xs uppercase tracking-[0.2em]">
                    {selectedSection?.title} • Step {selectedImage.id}
                  </p>
                </div>
              </div>

              <img
                src={selectedImage.image}
                alt={selectedImage.title}
                className="w-full rounded-2xl border border-slate-100 shadow-sm mb-6"
              />

              <div className="mb-6 flex items-center justify-between gap-3">
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
                    font-black
                    transition-all
                    ${
                      hasPreviousStep
                        ? "border-slate-200 bg-white text-slate-700 hover:border-moss-600 hover:text-moss-600 hover:shadow-sm"
                        : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                    }
                  `}
                >
                  <ChevronLeft size={18} />
                  Previous
                </button>

                <div className="text-center text-xs font-black text-slate-400 sm:text-sm">
                  Step {selectedImage.id} of {managementSteps.length}
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
                    font-black
                    transition-all
                    ${
                      hasNextStep
                        ? "border-moss-600 bg-moss-600 text-white hover:brightness-95 hover:shadow-sm"
                        : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                    }
                  `}
                >
                  Next
                  <ChevronRight size={18} />
                </button>
              </div>

              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 mb-6">
                <h4 className="text-sm font-black text-slate-800 mb-2 uppercase tracking-wide">
                  Instructions:
                </h4>

                <p className="text-slate-600 leading-relaxed">
                  {selectedImage.description}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </ManagementLayout>
  );
}

export default Help;