import React, {
  useState,
  useEffect,
  useRef
} from 'react';

import {
  Search,
  ChevronDown,
  Check
} from 'lucide-react';


function SearchableSelect({
  options = [],
  value,
  onChange,
  placeholder = "Select option...",
  label = "",
  className = "",
  variant = "default",
  disabled = false
}) {

  const [isOpen, setIsOpen] =
    useState(false);

  const [searchTerm, setSearchTerm] =
    useState('');

  const containerRef = useRef(null);


  // ============================================================
  // SELECTED OPTION
  // ============================================================

  const selectedOption =
    options.find(
      (opt) =>
        String(opt.id) ===
        String(value)
    );


  // ============================================================
  // CLOSE WHEN CLICKING OUTSIDE
  // ============================================================

  useEffect(() => {

    const handleClickOutside =
      (event) => {

        if (
          containerRef.current &&
          !containerRef.current.contains(
            event.target
          )
        ) {

          setIsOpen(false);

          setSearchTerm('');

        }

      };


    document.addEventListener(
      'mousedown',
      handleClickOutside
    );


    return () => {

      document.removeEventListener(
        'mousedown',
        handleClickOutside
      );

    };

  }, []);


  // ============================================================
  // CLOSE IF DISABLED
  // ============================================================

  useEffect(() => {

    if (disabled) {

      setIsOpen(false);

      setSearchTerm('');

    }

  }, [disabled]);


  // ============================================================
  // FILTER OPTIONS
  // ============================================================

  const filteredOptions =
    options.filter((opt) => {

      const name =
        String(
          opt?.name || ''
        ).toLowerCase();

      const acronym =
        String(
          opt?.acronym || ''
        ).toLowerCase();

      const search =
        searchTerm
          .trim()
          .toLowerCase();


      return (
        name.includes(search) ||
        acronym.includes(search)
      );

    });


  // ============================================================
  // SELECT OPTION
  // ============================================================

  const handleSelect =
    (option) => {

      if (disabled) {
        return;
      }

      console.log(
        "SearchableSelect selected:",
        option
      );

      onChange(option.id);

      setIsOpen(false);

      setSearchTerm('');

    };


  // ============================================================
  // TOGGLE DROPDOWN
  // ============================================================

  const handleToggle = () => {

    if (disabled) {
      return;
    }

    setIsOpen(
      (prev) => !prev
    );

  };


  // ============================================================
  // UI
  // ============================================================

  return (

    <div
      className={`
        relative
        ${className}
      `}
      ref={containerRef}
    >

      {
        label && (

          <p
            className="
              text-slate-400
              text-[10px]
              font-black
              uppercase
              tracking-[0.2em]
              mb-1
              leading-none
            "
          >
            {label}
          </p>

        )
      }


      {/* ======================================================
          SELECT BUTTON
          ====================================================== */}

      <div
        onClick={handleToggle}

        className={`
          flex
          items-center
          justify-between
          gap-3
          transition-all
          active:scale-[0.98]

          ${
            variant === 'ghost'

              ? `
                  px-0
                  py-1
                  bg-transparent
                  border-transparent
                  hover:text-moss-600
                `

              : `
                  px-4
                  py-3
                  bg-slate-50
                  border
                  border-slate-100
                  hover:border-moss-200
                  rounded-2xl
                `
          }

          ${
            isOpen &&
            variant !== 'ghost'

              ? `
                  ring-4
                  ring-moss-600/5
                  border-moss-300
                  bg-white
                `

              : ''
          }

          ${
            isOpen &&
            variant === 'ghost'

              ? 'text-moss-600'

              : ''
          }

          ${
            disabled

              ? `
                  opacity-60
                  cursor-not-allowed
                  bg-slate-100
                `

              : 'cursor-pointer'
          }
        `}
      >

        <div
          className="
            flex-grow
            truncate
          "
        >

          {
            selectedOption
              ? (

                <div
                  className="
                    flex
                    flex-col
                  "
                >

                  <span
                    className={`
                      font-black
                      tracking-tight
                      leading-tight

                      ${
                        variant === 'ghost'

                          ? `
                              text-lg
                              text-slate-900
                            `

                          : `
                              text-slate-800
                              text-sm
                            `
                      }
                    `}
                  >

                    {
                      selectedOption.acronym ||
                      selectedOption.name
                    }

                  </span>


                  {
                    selectedOption.acronym && (

                      <span
                        className={`
                          font-bold
                          uppercase
                          truncate
                          max-w-[300px]

                          ${
                            variant === 'ghost'

                              ? `
                                  text-[10px]
                                  text-slate-400
                                  mt-0.5
                                `

                              : `
                                  text-[9px]
                                  text-slate-400
                                `
                          }
                        `}
                      >

                        {
                          selectedOption.name
                        }

                      </span>

                    )
                  }

                </div>

              )
              : (

                <span
                  className="
                    text-slate-400
                    font-bold
                    text-sm
                  "
                >

                  {placeholder}

                </span>

              )
          }

        </div>


        <ChevronDown
          size={
            variant === 'ghost'
              ? 20
              : 18
          }

          className={`
            text-slate-400
            transition-transform
            duration-300

            ${
              isOpen
                ? `
                    rotate-180
                    text-moss-600
                  `
                : ''
            }
          `}
        />

      </div>


      {/* ======================================================
          DROPDOWN
          ====================================================== */}

      {
        isOpen &&
        !disabled && (

          <div
            className="
              absolute
              z-50
              mt-3
              w-full
              bg-white
              border
              border-slate-100
              shadow-2xl
              shadow-slate-200/50
              rounded-[2rem]
              overflow-hidden
              animate-in
              zoom-in-95
              fade-in
              duration-200
              origin-top
            "
          >

            {/* Search */}

            <div
              className="
                p-4
                border-b
                border-slate-50
                bg-slate-50/50
              "
            >

              <div
                className="
                  relative
                "
              >

                <Search
                  className="
                    absolute
                    left-4
                    top-1/2
                    -translate-y-1/2
                    text-slate-400
                  "
                  size={16}
                />


                <input
                  type="text"
                  autoFocus
                  placeholder="Search..."

                  value={
                    searchTerm
                  }

                  onChange={
                    (e) =>
                      setSearchTerm(
                        e.target.value
                      )
                  }

                  onClick={
                    (e) =>
                      e.stopPropagation()
                  }

                  className="
                    w-full
                    pl-11
                    pr-4
                    py-3
                    bg-white
                    border
                    border-slate-200
                    rounded-xl
                    text-sm
                    font-bold
                    focus:ring-4
                    focus:ring-moss-600/5
                    focus:border-moss-600
                    transition-all
                    outline-none
                  "
                />

              </div>

            </div>


            {/* Options */}

            <div
              className="
                max-h-64
                overflow-y-auto
                p-2
              "
            >

              {
                filteredOptions.length === 0
                  ? (

                    <div
                      className="
                        py-8
                        text-center
                        text-slate-400
                        font-medium
                        text-sm
                        italic
                      "
                    >

                      No matches found

                    </div>

                  )
                  : (

                    <div
                      className="
                        space-y-1
                      "
                    >

                      {
                        filteredOptions.map(
                          (option) => {

                            const isSelected =
                              String(value) ===
                              String(option.id);


                            return (

                              <div
                                key={
                                  option.id
                                }

                                onClick={
                                  (e) => {

                                    e.stopPropagation();

                                    handleSelect(
                                      option
                                    );

                                  }
                                }

                                className={`
                                  flex
                                  items-center
                                  justify-between
                                  px-4
                                  py-3.5
                                  rounded-xl
                                  cursor-pointer
                                  transition-all

                                  ${
                                    isSelected

                                      ? `
                                          bg-moss-50
                                          text-moss-700
                                        `

                                      : `
                                          hover:bg-slate-50
                                          text-slate-600
                                          hover:text-slate-900
                                        `
                                  }
                                `}
                              >

                                <div
                                  className="
                                    flex
                                    flex-col
                                  "
                                >

                                  <span
                                    className="
                                      font-bold
                                      text-xs
                                    "
                                  >

                                    {
                                      option.acronym ||
                                      option.name
                                    }

                                  </span>


                                  {
                                    option.acronym && (

                                      <span
                                        className="
                                          text-[9px]
                                          text-slate-400
                                          font-medium
                                        "
                                      >

                                        {
                                          option.name
                                        }

                                      </span>

                                    )
                                  }

                                </div>


                                {
                                  isSelected && (

                                    <Check
                                      size={16}
                                      className="
                                        text-moss-600
                                      "
                                    />

                                  )
                                }

                              </div>

                            );

                          }
                        )
                      }

                    </div>

                  )
              }

            </div>

          </div>

        )
      }

    </div>

  );

}


export default SearchableSelect;