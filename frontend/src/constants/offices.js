const API_URL = (
  import.meta.env.VITE_API_URL ||
  "/api"
).replace(/\/$/, "");

/**
 * Load all categories/offices from the database.
 */
export async function getOffices() {
  const response = await fetch(`${API_URL}/offices`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const contentType =
    response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error(
      "The server did not return valid JSON."
    );
  }

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.message ||
        result.error ||
        "Unable to retrieve categories."
    );
  }

  let officeList = [];

  if (Array.isArray(result)) {
    officeList = result;
  } else if (Array.isArray(result.offices)) {
    officeList = result.offices;
  } else if (Array.isArray(result.data)) {
    officeList = result.data;
  }

  return officeList.map((office) => {
    const divisions = Array.isArray(office.divisions)
      ? office.divisions
      : [];

    return {
      id: Number(office.id),
      name: office.name || "Untitled Category",
      acronym: office.acronym || "",
      description: office.description || "",
      iconName: office.iconName || "IconWorld",
      divisions,
      sections: Array.isArray(office.sections)
        ? office.sections
        : divisions.map((division) => division.name),
      reportUrls:
        office.reportUrls &&
        typeof office.reportUrls === "object"
          ? office.reportUrls
          : {},
    };
  });
}

/**
 * Load one category/office by ID.
 */
export async function getOfficeById(officeId) {
  const numericOfficeId = Number(officeId);

  if (!Number.isInteger(numericOfficeId)) {
    throw new Error(
      "A valid category ID is required."
    );
  }

  const offices = await getOffices();

  return (
    offices.find(
      (office) =>
        office.id === numericOfficeId
    ) || null
  );
}