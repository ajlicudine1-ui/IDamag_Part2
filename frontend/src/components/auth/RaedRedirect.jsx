import React, { useEffect } from 'react';

export const RAED_REPORT_URL = 'https://app.powerbi.com/view?r=eyJrIjoiNTRhMTNiZTYtNTZiYS00ZDUyLTg5ZjAtMmQzOTgxOWQ2NDU0IiwidCI6IjI1MzYzMDI3LTUyNjQtNGE1Mi04MmRjLTgzYWNiZTMwY2M4YiIsImMiOjEwfQ%3D%3D&fbclid=IwY2xjawUywzxleHRuA2FlbQIxMQBwZG9mA3NydGMGYXBwX2lkATAAAR681VABo27zK3BVbH2psHYtoMB9uLQ4yQo1p4mW1AWhRYvEVt1X6MBWkrEsbw_aem_meGvsIdElOm17WLhE6OwsQ';

export default function RaedRedirect() {
  useEffect(() => {
    window.location.replace(RAED_REPORT_URL);
  }, []);

  return <p className="p-6 text-center">Opening the RAED report… <a href={RAED_REPORT_URL}>Continue to Power BI</a></p>;
}
