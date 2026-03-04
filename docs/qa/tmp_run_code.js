async (page) => {
  const data = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")];
    return els.map((el, i) => ({
      i,
      id: el.id || null,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0,80),
      disabled: !!el.disabled,
      hidden: !!(el.offsetParent === null)
    }));
  });
  return data.slice(0, 12);
}