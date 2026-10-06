import React, { useEffect } from 'react';

export const RAED_REPORT_URL = 'https://app.powerbi.com/view?r=eyJrIjoiZTI1OTU2M2QtZmNkYi00NmExLWEyM2YtOWM0ODJkOTFlM2Y0IiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ%3D%3D';

export default function RaedRedirect() {
  useEffect(() => {
    window.location.replace(RAED_REPORT_URL);
  }, []);

  return <p className="p-6 text-center">Opening the RAED report… <a href={RAED_REPORT_URL}>Continue to Power BI</a></p>;
}
