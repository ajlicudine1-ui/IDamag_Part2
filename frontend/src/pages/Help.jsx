import React, { useState } from "react";
import ManagementLayout from "../components/management/ManagementLayout";
import {
  BookOpen,
  UserCircle,
  Settings,
  Monitor,
  ChevronRight,
  Maximize2,
  X,
  FileText,
  Users as UsersIcon,
  Building2,
  Lock,
  Search,
} from "lucide-react";

const managementSteps = [
  {
    id: 1,
    title: "Login to Dashboard",
    description:
      "Access the management system using your authorized credentials.",
    image: "/iDAMAG/For Management Users/1. Login.png",
    icon: Lock,
  },
  {
    id: 2,
    title: "User Registration",
    description:
      "New staff members can register for an account (subject to admin approval).",
    image: "/iDAMAG/For Management Users/1.1 Register.png",
    icon: UserCircle,
  },
  {
    id: 3,
    title: "Reports Management",
    description:
      "View and manage all submitted reports in a centralized dashboard.",
    image: "/iDAMAG/For Management Users/2. Reports Management.png",
    icon: LayoutDashboardIcon,
  },
  {
    id: 4,
    title: "Add New Report",
    description:
      "Create new damage or monitoring reports with detailed information and attachments.",
    image: "/iDAMAG/For Management Users/3. Add Report.png",
    icon: FilePlusIcon,
  },
  {
    id: 5,
    title: "Edit Existing Report",
    description:
      "Update or correct information in previously submitted reports.",
    image: "/iDAMAG/For Management Users/4. Edit Report.png",
    icon: EditIcon,
  },
  {
    id: 6,
    title: "User Management (Admin)",
    description:
      "Administrators can manage user accounts, roles, and access levels.",
    image: "/iDAMAG/For Management Users/5. User Management.png",
    icon: UsersIcon,
  },
  {
    id: 7,
    title: "Add New User",
    description:
      "Directly add new users to the system from the admin panel.",
    image: "/iDAMAG/For Management Users/6. Add User.png",
    icon: UserPlusIcon,
  },
  {
    id: 8,
    title: "Edit User Details",
    description:
      "Modify user profiles, reset passwords, or change account statuses.",
    image: "/iDAMAG/For Management Users/7. Edit User.png",
    icon: Edit3Icon,
  },
  {
    id: 9,
    title: "Office Management",
    description:
      "Configure offices, divisions, and sections within the organization.",
    image: "/iDAMAG/For Management Users/8. Office Management.png",
    icon: Building2,
  },
  {
    id: 10,
    title: "Manage Sections",
    description:
      "Add or edit specific sections within an office for better reporting granularity.",
    image: "/iDAMAG/For Management Users/9. Add Section.png",
    icon: Settings,
  },
];

// Helper Icons
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

function Help() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSteps = managementSteps.filter(
    (step) =>
      step.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      step.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ManagementLayout title="System Help Guide">
      <div className="space-y-8 animate-in fade-in duration-700">
        
        {/* Header Section */}
        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm relative overflow-hidden group">
          
          <div className="absolute top-0 right-0 w-64 h-64 bg-moss-50 rounded-full -translate-y-1/2 translate-x-1/2 opacity-50 group-hover:scale-110 transition-transform duration-700" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            
            <div>
              <h1 className="text-3xl font-black text-slate-900 mb-2 flex items-center gap-3">
                <BookOpen
                  className="text-moss-600"
                  size={32}
                />

                Management Help Guide
              </h1>

              <p className="text-slate-500 font-medium">
                Browse through the visual tutorials to learn how to use the
                management system.
              </p>
            </div>

            {/* Search */}
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

        {/* Management Label */}
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
            Management Guide
          </div>
        </div>

        {/* Help Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {filteredSteps.length > 0 ? (
            filteredSteps.map((step, index) => {
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
                  {/* Image */}
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

                    {/* Hover */}
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

                    {/* Icon */}
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
                      <StepIcon
                        size={20}
                        className="text-moss-600"
                      />
                    </div>
                  </div>

                  {/* Information */}
                  <div className="p-6 flex-grow flex flex-col">
                    <div className="flex items-center gap-2 text-[10px] font-black text-moss-600 uppercase tracking-widest mb-3">
                      Step {step.id}
                      <ChevronRight size={10} />
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
            })
          ) : (
            /* No Results */
            <div
              className="
                col-span-full
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
                We couldn't find any tutorials matching "{searchQuery}". Try
                different keywords.
              </p>

              <button
                onClick={() => setSearchQuery("")}
                className="mt-6 text-moss-600 font-black text-sm hover:underline"
              >
                Clear search
              </button>
            </div>
          )}
        </div>

        {/* Footer Help */}
        <div className="bg-moss-600 rounded-3xl p-10 text-white relative overflow-hidden">
          
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-white/10 rounded-full translate-y-1/2 translate-x-1/4" />

          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
            <div>
              <h2 className="text-2xl font-black mb-2">
                Still need assistance?
              </h2>

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

      {/* Image Modal */}
      {selectedImage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-10">
          
          {/* Background */}
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300"
            onClick={() => setSelectedImage(null)}
          />

          {/* Modal */}
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
              max-h-full
              overflow-hidden
              animate-in
              zoom-in-95
              duration-300
            "
          >
            {/* Close */}
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

            <div className="h-full overflow-y-auto pr-2 custom-scrollbar">
              
              {/* Modal Header */}
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
                    Step {selectedImage.id}
                  </p>
                </div>
              </div>

              {/* Image */}
              <img
                src={selectedImage.image}
                alt={selectedImage.title}
                className="w-full rounded-2xl border border-slate-100 shadow-sm mb-6"
              />

              {/* Instructions */}
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