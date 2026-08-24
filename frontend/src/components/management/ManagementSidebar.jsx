import React, { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Building2,
  History,
  HelpCircle,
  MessageSquareText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import logo from "../../assets/dalogo.png";

function ManagementSidebar({ isCollapsed, setIsCollapsed }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");

    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const navItems = [
    {
      name: "Reports",
      icon: LayoutDashboard,
      path: "/reports",
    },
  ];

  // Only show Admin Management items
  if (user?.role === "Admin") {
    navItems.push({
      name: "User Management",
      icon: Users,
      path: "/users",
    });

    navItems.push({
      name: "Office Management",
      icon: Building2,
      path: "/office-division-management",
    });

    navItems.push({
      name: "Manage Feedbacks",
      icon: MessageSquareText,
      path: "/feedback-management",
    });

    navItems.push({
      name: "Activity Logs",
      icon: History,
      path: "/activity-logs",
    });
  }

  const helpItem = {
    name: "Help",
    icon: HelpCircle,
    path: "/help",
  };

  return (
    <aside
      className={`
        relative h-full bg-white border-r border-slate-100
        flex flex-col flex-shrink-0 z-30
        transition-all duration-500 ease-in-out
        ${isCollapsed ? "w-20" : "w-72"}
      `}
    >
      {/* Manual Collapse Toggle */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="
          absolute -right-3 top-24
          w-6 h-6
          bg-white border border-slate-200
          rounded-full
          flex items-center justify-center
          text-slate-400
          hover:text-moss-600
          hover:border-moss-200
          hover:shadow-md
          transition-all
          z-40
        "
        aria-label={
          isCollapsed
            ? "Expand sidebar"
            : "Collapse sidebar"
        }
      >
        {isCollapsed ? (
          <ChevronRight size={12} />
        ) : (
          <ChevronLeft size={12} />
        )}
      </button>

      {/* Logo */}
      <div
        className={`
          border-b border-slate-50
          transition-all duration-500
          overflow-hidden
          ${
            isCollapsed
              ? "p-4 mb-4 flex justify-center"
              : "p-8 mb-6"
          }
        `}
      >
        <div className="flex items-center gap-3 text-slate-800 transition-colors group">
          <img
            src={logo}
            alt="DA Logo"
            className="
              w-10 h-10
              object-contain
              transition-transform duration-500
              group-hover:rotate-12
              flex-shrink-0
            "
          />

          {!isCollapsed && (
            <span className="
              text-xl
              font-black
              tracking-tighter
              uppercase
              whitespace-nowrap
              animate-in
              fade-in
              duration-500
            ">
              IDAMAG
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav
        className={`
          flex-grow
          space-y-2
          transition-all duration-500
          ${isCollapsed ? "px-2" : "px-4"}
        `}
      >
        {!isCollapsed && (
          <p className="
            px-4
            text-[10px]
            font-bold
            text-slate-400
            uppercase
            tracking-[0.2em]
            mb-4
            animate-in
            fade-in
            duration-500
          ">
            Management
          </p>
        )}

        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            title={isCollapsed ? item.name : ""}
            className={({ isActive }) => `
              flex items-center
              rounded-2xl
              font-bold
              text-sm
              transition-all
              group
              relative

              ${
                isCollapsed
                  ? "justify-center p-3"
                  : "gap-3 px-4 py-3.5"
              }

              ${
                isActive
                  ? "bg-moss-600 text-white shadow-lg shadow-moss-600/20"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              }
            `}
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={20}
                  className={`
                    flex-shrink-0
                    transition-colors

                    ${
                      isActive
                        ? "text-white"
                        : "text-slate-400 group-hover:text-moss-600"
                    }
                  `}
                />

                {!isCollapsed && (
                  <span className="
                    animate-in
                    fade-in
                    slide-in-from-left-2
                    duration-300
                    whitespace-nowrap
                  ">
                    {item.name}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Help */}
      <div
        className={`
          mt-auto
          pb-8
          space-y-2
          transition-all duration-500
          ${isCollapsed ? "px-2" : "px-4"}
        `}
      >
        <NavLink
          to={helpItem.path}
          title={isCollapsed ? helpItem.name : ""}
          className={({ isActive }) => `
            flex items-center
            rounded-2xl
            font-bold
            text-sm
            transition-all
            group

            ${
              isCollapsed
                ? "justify-center p-3"
                : "gap-3 px-4 py-3.5"
            }

            ${
              isActive
                ? "bg-moss-600 text-white shadow-lg shadow-moss-600/20"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }
          `}
        >
          {({ isActive }) => (
            <>
              <helpItem.icon
                size={20}
                className={`
                  flex-shrink-0
                  transition-colors

                  ${
                    isActive
                      ? "text-white"
                      : "text-slate-400 group-hover:text-moss-600"
                  }
                `}
              />

              {!isCollapsed && (
                <span className="
                  animate-in
                  fade-in
                  slide-in-from-left-2
                  duration-300
                  whitespace-nowrap
                ">
                  {helpItem.name}
                </span>
              )}
            </>
          )}
        </NavLink>
      </div>
    </aside>
  );
}


export default ManagementSidebar;