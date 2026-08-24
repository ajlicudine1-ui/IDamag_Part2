import React, { useRef, useState } from "react";

import chatbotLogo from "../../assets/botbot.png";
import chatbotThinkingLogo from "../../assets/BOT_THINKING.png";

const FloatingChatbotButton = ({
  onClick,
  isOpen,
  position,
  setPosition,
}) => {
  const [isDragging, setIsDragging] =
    useState(false);

  const dragStart = useRef({
    pointerX: 0,
    pointerY: 0,
    startX: 0,
    startY: 0,
  });

  const hasDragged = useRef(false);

  // =====================================================
  // CHAT HEAD SIZE
  // =====================================================

  const getButtonSize = () => {
    if (window.innerWidth >= 1024) {
      return 144;
    }

    if (window.innerWidth >= 640) {
      return 128;
    }

    return 112;
  };

  // =====================================================
  // KEEP CHAT HEAD INSIDE SCREEN
  // =====================================================

  const clampPosition = (x, y) => {
    const buttonSize = getButtonSize();

    const maxX = Math.max(
      0,
      window.innerWidth - buttonSize
    );

    const maxY = Math.max(
      0,
      window.innerHeight - buttonSize
    );

    return {
      x: Math.max(
        0,
        Math.min(x, maxX)
      ),

      y: Math.max(
        0,
        Math.min(y, maxY)
      ),
    };
  };

  // =====================================================
  // START DRAGGING
  // =====================================================

  const handlePointerDown = (event) => {
    // Only allow the main mouse button
    if (
      event.pointerType === "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();

    hasDragged.current = false;

    dragStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: position.x,
      startY: position.y,
    };

    setIsDragging(true);

    event.currentTarget.setPointerCapture(
      event.pointerId
    );
  };

  // =====================================================
  // MOVE CHAT HEAD
  // =====================================================

  const handlePointerMove = (event) => {
    if (!isDragging) {
      return;
    }

    const deltaX =
      event.clientX -
      dragStart.current.pointerX;

    const deltaY =
      event.clientY -
      dragStart.current.pointerY;

    // Require a small movement before
    // considering it a real drag
    if (
      Math.abs(deltaX) > 5 ||
      Math.abs(deltaY) > 5
    ) {
      hasDragged.current = true;
    }

    const nextPosition = clampPosition(
      dragStart.current.startX + deltaX,
      dragStart.current.startY + deltaY
    );

    setPosition(nextPosition);
  };

  // =====================================================
  // FINISH DRAG / CLICK
  // =====================================================

  const finishDrag = (event) => {
    if (!isDragging) {
      return;
    }

    setIsDragging(false);

    try {
      if (
        event.currentTarget.hasPointerCapture(
          event.pointerId
        )
      ) {
        event.currentTarget.releasePointerCapture(
          event.pointerId
        );
      }
    } catch {
      // Pointer capture may already be released
    }

    // If it wasn't dragged,
    // treat it as a normal click
    if (!hasDragged.current) {
      onClick();
    }
  };

  return (
    <div
      className="
        fixed
        z-[9999]
        group
      "
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        touchAction: "none",
      }}
    >
      {/* =================================================
          HOVER MESSAGE
      ================================================= */}

      {!isOpen && !isDragging && (
        <div
          className="
            absolute

            bottom-[92%]
            right-2

            w-[300px]
            max-w-[calc(100vw-32px)]

            bg-white

            border-2
            border-[#235E26]

            rounded-[18px]

            px-[18px]
            py-[14px]

            text-[#235E26]
            text-[17px]
            font-bold
            leading-[1.4]
            text-left

            shadow-md

            opacity-0
            invisible

            group-hover:opacity-100
            group-hover:visible

            transition-all
            duration-200

            pointer-events-none
          "
        >
          Ask I-DAmag Chatbot anything!

          {/* Speech bubble arrow */}

          <div
            className="
              absolute

              -bottom-[11px]
              right-[25px]

              w-5
              h-5

              bg-white

              border-r-2
              border-b-2
              border-[#235E26]

              rotate-45
            "
          />
        </div>
      )}

      {/* =================================================
          DRAGGABLE CHAT HEAD
      ================================================= */}

      <button
        type="button"
        aria-label={
          isOpen
            ? "Close iDamag Chatbot"
            : "Open iDamag Chatbot"
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className={`
          rounded-full

          bg-transparent
          border-0
          p-0

          flex
          items-center
          justify-center

          overflow-visible

          select-none

          ${
            isDragging
              ? `
                cursor-grabbing
                scale-105
              `
              : `
                cursor-grab
              `
          }

          transition-transform
          duration-150

          w-28
          h-28

          sm:w-32
          sm:h-32

          lg:w-36
          lg:h-36

          ${
            !isOpen
              ? "hover:scale-105"
              : ""
          }
        `}
      >
        {/* =================================================
            CHATBOT IMAGE

            CLOSED = botbot.png
            OPEN   = BOT_THINKING.png

            The BUTTON stays exactly the same size.
            Only the thinking artwork is slightly scaled
            to visually match botbot.png.
        ================================================= */}

        <img
          src={
            isOpen
              ? chatbotThinkingLogo
              : chatbotLogo
          }
          alt={
            isOpen
              ? "iDamag Chatbot Thinking"
              : "iDamag Chatbot"
          }
          draggable="false"
          className={`
            object-contain

            pointer-events-none
            select-none

            ${
              isOpen
                ? `
                  w-[82%]
                  h-[82%]
                `
                : `
                  w-full
                  h-full
                `
            }
          `}
        />
      </button>
    </div>
  );
};

export default FloatingChatbotButton;