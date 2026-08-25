import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';

import {
  createUser,
  getOffices,
  getDivisions
} from '../../services/api';

import logo from '../../assets/dalogo.png';
import SearchableSelect from '../../components/common/SearchableSelect';


function Register() {

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    suffix: '',
    email: '',
    password: '',
    confirmPassword: '',
    officeId: '',
    divisionId: ''
  });

  const [offices, setOffices] = useState([]);
  const [divisions, setDivisions] = useState([]);

  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [isLoading, setIsLoading] =
    useState(false);

  const navigate = useNavigate();


  // ============================================================
  // LOAD OFFICES / CATEGORIES
  // ============================================================

  useEffect(() => {

    const loadOffices = async () => {

      try {

        const response = await getOffices();

        console.log(
          "Offices received:",
          response.data
        );

        setOffices(
          Array.isArray(response.data)
            ? response.data
            : []
        );

      } catch (err) {

        console.error(
          "Could not load offices:",
          err
        );

        setOffices([]);

      }

    };

    loadOffices();

  }, []);


  // ============================================================
  // LOAD DIVISIONS / SUBCATEGORIES
  // ============================================================

  useEffect(() => {

    const loadDivisions = async () => {

      if (!formData.officeId) {

        setDivisions([]);

        return;

      }

      try {

        console.log(
          "Loading divisions for office:",
          formData.officeId
        );

        const response =
          await getDivisions(
            formData.officeId
          );

        console.log(
          "Divisions received:",
          response.data
        );

        setDivisions(
          Array.isArray(response.data)
            ? response.data
            : []
        );

      } catch (err) {

        console.error(
          "Could not load divisions:",
          err
        );

        setDivisions([]);

      }

    };

    loadDivisions();

  }, [formData.officeId]);


  // ============================================================
  // AUTO DISMISS MESSAGES
  // ============================================================

  useEffect(() => {

    if (error || success) {

      const timer = setTimeout(() => {

        setError('');

        if (success) {
          navigate('/login');
        }

      }, 3000);

      return () => clearTimeout(timer);

    }

  }, [
    error,
    success,
    navigate
  ]);


  // ============================================================
  // INPUT CHANGE
  // ============================================================

  const handleInputChange =
    (field) => (e) => {

      setFormData((prev) => ({
        ...prev,
        [field]: e.target.value
      }));

      if (error) {
        setError('');
      }

    };


  // ============================================================
  // SELECT CHANGE
  // ============================================================

  const handleSelectChange =
    (field) => (value) => {

      /*
       * SearchableSelect may return either:
       *
       * 11
       *
       * OR
       *
       * {
       *   id: 11,
       *   name: "Agricultural Production"
       * }
       *
       * Normalize it so we always store the ID.
       */

      const normalizedValue =
        value &&
        typeof value === "object"
          ? (
              value.id ??
              value.value ??
              ""
            )
          : value;

      console.log(
        `${field} selected:`,
        normalizedValue
      );

      setFormData((prev) => ({
        ...prev,

        [field]:
          normalizedValue,

        /*
         * When another category is selected,
         * clear the previously selected
         * subcategory.
         */
        ...(field === "officeId"
          ? {
              divisionId: ""
            }
          : {})
      }));

      if (field === "officeId") {

        /*
         * Clear old divisions while the
         * new office's divisions are loading.
         */
        setDivisions([]);

      }

      if (error) {
        setError('');
      }

    };


  // ============================================================
  // PASSWORD VALIDATION
  // ============================================================

  const validatePassword = (
    password
  ) => {

    const minLength = 8;

    const hasUpper =
      /[A-Z]/.test(password);

    const hasLower =
      /[a-z]/.test(password);

    const hasNumber =
      /[0-9]/.test(password);

    const hasSpecial =
      /[!@#$%^&*(),.?":{}|<>]/.test(
        password
      );

    if (
      password.length <
      minLength
    ) {

      return (
        "Password must be at least " +
        "8 characters long."
      );

    }

    if (!hasUpper) {

      return (
        "Password must contain at least " +
        "one uppercase letter (A-Z)."
      );

    }

    if (!hasLower) {

      return (
        "Password must contain at least " +
        "one lowercase letter (a-z)."
      );

    }

    if (!hasNumber) {

      return (
        "Password must contain at least " +
        "one number (0-9)."
      );

    }

    if (!hasSpecial) {

      return (
        "Password must contain at least " +
        "one special character."
      );

    }

    return null;

  };


  // ============================================================
  // REGISTER
  // ============================================================

  const handleRegister =
    async (e) => {

      e.preventDefault();

      setIsLoading(true);

      setError('');

      // --------------------------------------------------------
      // OFFICE / DIVISION VALIDATION
      // --------------------------------------------------------

      if (
        !formData.officeId ||
        !formData.divisionId
      ) {

        setError(
          "Please select both an Office and a Division."
        );

        setIsLoading(false);

        return;

      }


      // --------------------------------------------------------
      // PASSWORD CONFIRMATION
      // --------------------------------------------------------

      if (
        formData.password !==
        formData.confirmPassword
      ) {

        setError(
          "Passwords do not match."
        );

        setIsLoading(false);

        return;

      }


      // --------------------------------------------------------
      // PASSWORD STRENGTH
      // --------------------------------------------------------

      const passwordError =
        validatePassword(
          formData.password
        );

      if (passwordError) {

        setError(
          passwordError
        );

        setIsLoading(false);

        return;

      }


      // --------------------------------------------------------
      // REMOVE CONFIRM PASSWORD
      // --------------------------------------------------------

      const {
        confirmPassword,
        ...submitData
      } = formData;


      try {

        console.log(
          "Registration data:",
          submitData
        );

        // Force public registrations
        // to Staff role.
        await createUser({
          ...submitData,
          role: 'Staff'
        });


        setSuccess(
          "Registration successful! " +
          "Your account is now pending " +
          "administrative approval."
        );

      } catch (err) {

        console.error(
          "Registration error:",
          err
        );

        setError(
          err.response?.data?.message ||
          err.response?.data?.error ||
          (
            "Registration failed. " +
            "Please make sure email is unique."
          )
        );

      } finally {

        setIsLoading(false);

      }

    };


  // ============================================================
  // UI
  // ============================================================

  return (

    <div
      className="
        min-h-screen
        bg-slate-50
        flex
        flex-col
        justify-center
        items-center
        p-6
        py-12
      "
    >

      <div
        className="
          w-full
          max-w-2xl
          bg-white
          rounded-3xl
          shadow-xl
          border
          border-slate-100
          p-8
          md:p-10
        "
      >


        {/* =====================================================
            HEADER
            ===================================================== */}

        <div
          className="
            text-center
            mb-10
          "
        >

          <div
            className="
              w-16
              h-16
              mx-auto
              mb-4
              flex
              items-center
              justify-center
              transition-transform
              hover:scale-105
              duration-300
            "
          >

            <img
              src={logo}
              alt="DA Logo"
              className="
                w-full
                h-full
                object-contain
                drop-shadow-md
              "
            />

          </div>


          <h1
            className="
              text-2xl
              font-extrabold
              text-slate-900
              tracking-tight
            "
          >
            Create Account
          </h1>


          <p
            className="
              text-sm
              font-bold
              text-slate-500
              mt-1.5
              uppercase
              tracking-widest
            "
          >
            Ilocos DAmag
          </p>

        </div>


        {/* =====================================================
            ERROR MESSAGE
            ===================================================== */}

        {error && (

          <div
            className="
              mb-5
              px-4
              py-2
              bg-red-50
              text-red-600
              rounded-xl
              text-[11px]
              font-bold
              border
              border-red-100
              animate-in
              fade-in
              slide-in-from-top-2
              duration-300
              flex
              items-center
              gap-2
            "
          >

            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="
                h-3
                w-3
                flex-shrink-0
              "
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >

              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="
                  M12 8v4m0 4h.01
                  M21 12a9 9 0
                  11-18 0
                  9 9 0
                  0118 0z
                "
              />

            </svg>

            <span
              className="
                leading-tight
              "
            >
              {error}
            </span>

          </div>

        )}


        {/* =====================================================
            SUCCESS MESSAGE
            ===================================================== */}

        {success && (

          <div
            className="
              mb-5
              px-4
              py-2
              bg-moss-50
              text-moss-600
              rounded-xl
              text-[11px]
              font-bold
              border
              border-moss-100
              animate-in
              fade-in
              slide-in-from-top-2
              duration-300
              flex
              items-center
              gap-2
            "
          >

            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="
                h-3
                w-3
                flex-shrink-0
              "
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >

              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />

            </svg>

            <span
              className="
                leading-tight
              "
            >
              {success}
            </span>

          </div>

        )}


        {/* =====================================================
            REGISTRATION FORM
            ===================================================== */}

        <form
          onSubmit={handleRegister}
          className="
            grid
            grid-cols-1
            md:grid-cols-12
            gap-4
            md:gap-5
          "
        >


          {/* ===================================================
              FIRST NAME
              =================================================== */}

          <div
            className="
              md:col-span-5
            "
          >

            <label
              className="
                block
                text-xs
                font-bold
                text-slate-700
                mb-1.5
                pl-1
              "
            >
              First Name
            </label>

            <input
              type="text"
              required
              value={
                formData.firstName
              }
              onChange={
                handleInputChange(
                  'firstName'
                )
              }
              className="
                w-full
                px-4
                py-3
                bg-slate-50
                border
                border-slate-200
                rounded-xl
                text-sm
                focus:ring-4
                focus:ring-moss-600/10
                focus:border-moss-600
                transition-all
                outline-none
              "
              placeholder="Juan"
            />

          </div>


          {/* ===================================================
              LAST NAME
              =================================================== */}

          <div
            className="
              md:col-span-5
            "
          >

            <label
              className="
                block
                text-xs
                font-bold
                text-slate-700
                mb-1.5
                pl-1
              "
            >
              Last Name
            </label>

            <input
              type="text"
              required
              value={
                formData.lastName
              }
              onChange={
                handleInputChange(
                  'lastName'
                )
              }
              className="
                w-full
                px-4
                py-3
                bg-slate-50
                border
                border-slate-200
                rounded-xl
                text-sm
                focus:ring-4
                focus:ring-moss-600/10
                focus:border-moss-600
                transition-all
                outline-none
              "
              placeholder="Dela Cruz"
            />

          </div>


          {/* ===================================================
              SUFFIX
              =================================================== */}

          <div
            className="
              md:col-span-2
            "
          >

            <label
              className="
                block
                text-xs
                font-bold
                text-slate-700
                mb-1.5
                pl-1
              "
              title="Optional"
            >
              Suffix
            </label>

            <input
              type="text"
              value={
                formData.suffix
              }
              onChange={
                handleInputChange(
                  'suffix'
                )
              }
              className="
                w-full
                px-4
                py-3
                bg-slate-50
                border
                border-slate-200
                rounded-xl
                text-sm
                focus:ring-4
                focus:ring-moss-600/10
                focus:border-moss-600
                transition-all
                outline-none
              "
              placeholder="Jr."
            />

          </div>


          {/* ===================================================
              EMAIL
              =================================================== */}

          <div
            className="
              md:col-span-12
            "
          >

            <label
              className="
                block
                text-xs
                font-bold
                text-slate-700
                mb-1.5
                pl-1
              "
            >
              Email Address
            </label>

            <input
              type="email"
              required
              value={
                formData.email
              }
              onChange={
                handleInputChange(
                  'email'
                )
              }
              className="
                w-full
                px-4
                py-3
                bg-slate-50
                border
                border-slate-200
                rounded-xl
                text-sm
                focus:ring-4
                focus:ring-moss-600/10
                focus:border-moss-600
                transition-all
                outline-none
              "
              placeholder="
                juan.delacruz@da.gov.ph
              "
            />

          </div>


          {/* ===================================================
              CATEGORY / OFFICE
              =================================================== */}

          <div
            className="
              md:col-span-6
            "
          >

            <label
              className="
                block
                text-xs
                font-bold
                text-slate-700
                mb-1.5
                pl-1
              "
            >
              Categories
            </label>

            <SearchableSelect
                options={divisions}
                value={formData.divisionId}
                onChange={handleSelectChange('divisionId')}
                disabled={!formData.officeId}
                placeholder={
                  formData.officeId
                    ? "Select your Subcategory..."
                    : "Select Category First"
                }
              />

          </div>


          {/* ===================================================
              SUBCATEGORY / DIVISION
              =================================================== */}

          <div
            className="
              md:col-span-6
            "
          >

            <label
              className="
                block
                text-xs
                font-bold
                text-slate-700
                mb-1.5
                pl-1
              "
            >
              Subcategories
            </label>

            <SearchableSelect
              options={divisions}
              value={
                formData.divisionId
              }
              onChange={
                handleSelectChange(
                  'divisionId'
                )
              }
              placeholder={
                formData.officeId
                  ? "Select your Subcategory..."
                  : "Select Category First"
              }
            />

          </div>


          {/* ===================================================
              PASSWORD
              =================================================== */}

          <div
            className="
              md:col-span-6
            "
          >

            <label
              className="
                block
                text-xs
                font-bold
                text-slate-700
                mb-1.5
                pl-1
              "
            >
              Password
            </label>

            <div
              className="
                relative
              "
            >

              <input
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                required
                value={
                  formData.password
                }
                onChange={
                  handleInputChange(
                    'password'
                  )
                }
                className="
                  w-full
                  pl-4
                  pr-12
                  py-3
                  bg-slate-50
                  border
                  border-slate-200
                  rounded-xl
                  text-sm
                  focus:ring-4
                  focus:ring-moss-600/10
                  focus:border-moss-600
                  transition-all
                  outline-none
                "
                placeholder="••••••••"
              />

              <button
                type="button"
                className="
                  absolute
                  right-3
                  top-1/2
                  -translate-y-1/2
                  text-slate-400
                  hover:text-slate-600
                  p-1
                "
                onClick={() =>
                  setShowPassword(
                    !showPassword
                  )
                }
                tabIndex="-1"
              >

                {
                  showPassword
                    ? (
                        <EyeOff
                          size={18}
                        />
                      )
                    : (
                        <Eye
                          size={18}
                        />
                      )
                }

              </button>

            </div>

            <p
              className="
                text-[10px]
                text-slate-400
                mt-1.5
                pl-1
                font-medium
                leading-tight
              "
            >
              8+ chars, uppercase,
              lowercase, number &
              special char.
            </p>

          </div>


          {/* ===================================================
              CONFIRM PASSWORD
              =================================================== */}

          <div
            className="
              md:col-span-6
            "
          >

            <label
              className="
                block
                text-xs
                font-bold
                text-slate-700
                mb-1.5
                pl-1
              "
            >
              Confirm Password
            </label>

            <div
              className="
                relative
              "
            >

              <input
                type={
                  showConfirmPassword
                    ? "text"
                    : "password"
                }
                required
                value={
                  formData.confirmPassword
                }
                onChange={
                  handleInputChange(
                    'confirmPassword'
                  )
                }
                className="
                  w-full
                  pl-4
                  pr-12
                  py-3
                  bg-slate-50
                  border
                  border-slate-200
                  rounded-xl
                  text-sm
                  focus:ring-4
                  focus:ring-moss-600/10
                  focus:border-moss-600
                  transition-all
                  outline-none
                "
                placeholder="••••••••"
              />

              <button
                type="button"
                className="
                  absolute
                  right-3
                  top-1/2
                  -translate-y-1/2
                  text-slate-400
                  hover:text-slate-600
                  p-1
                "
                onClick={() =>
                  setShowConfirmPassword(
                    !showConfirmPassword
                  )
                }
                tabIndex="-1"
              >

                {
                  showConfirmPassword
                    ? (
                        <EyeOff
                          size={18}
                        />
                      )
                    : (
                        <Eye
                          size={18}
                        />
                      )
                }

              </button>

            </div>

          </div>


          {/* ===================================================
              SUBMIT
              =================================================== */}

          <div
            className="
              md:col-span-12
              mt-4
              pt-4
              border-t
              border-slate-100
            "
          >

            <button
              type="submit"
              disabled={
                isLoading ||
                success
              }
              className={`
                w-full
                bg-moss-600
                hover:bg-moss-700
                text-white
                text-sm
                font-bold
                py-4
                rounded-xl
                shadow-lg
                shadow-moss-600/20
                transition-all
                transform
                active:scale-[0.99]

                ${
                  isLoading ||
                  success
                    ? (
                        "opacity-70 " +
                        "cursor-not-allowed"
                      )
                    : ""
                }
              `}
            >

              {
                isLoading
                  ? "Registering..."
                  : success
                    ? (
                        "Success! " +
                        "Redirecting..."
                      )
                    : (
                        "Complete " +
                        "Registration"
                      )
              }

            </button>

          </div>

        </form>


        {/* =====================================================
            FOOTER
            ===================================================== */}

        <div
          className="
            mt-8
            pt-6
            border-t
            border-slate-100
            text-center
            space-y-3
          "
        >

          <p
            className="
              text-xs
              text-slate-500
              font-medium
            "
          >

            Already have an account?

            {' '}

            <Link
              to="/login"
              className="
                text-moss-600
                font-bold
                hover:underline
              "
            >
              Sign In
            </Link>

          </p>


          <div
            className="
              block
            "
          >

            <Link
              to="/"
              className="
                text-slate-400
                hover:text-moss-600
                text-[11px]
                font-bold
                transition-colors
              "
            >
              ← Back to Public Site
            </Link>

          </div>

        </div>

      </div>

    </div>

  );

}


export default Register;