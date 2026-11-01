//utility.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//서버 네트워크 인터페이스 조회 관련.
//로직/주석은 원본과 동일 (동작 변경 없음).

const os = require('os');

exports.getIPv6Address = (): string[] =>
{
  const networkInterfaces = os.networkInterfaces();
  const ipv6Addresses: string[] = [];

  for (const interfaceKey in networkInterfaces)
  {
    const interfaces = networkInterfaces[interfaceKey];
    for (let i = 0; i < interfaces.length; i++)
    {
      const address = interfaces[i];
      //fe80::/10(링크 로컬)은 외부로 라우팅이 안 돼서 yt-dlp --source-address로 쓰면 항상
      //"Network is unreachable" - 인터페이스 순서에 따라 [0]으로 뽑힐 수 있어 제외 (2026-11-01)
      if (address.family === 'IPv6' && !address.internal && !/^fe[89ab]/i.test(address.address))
      {
        ipv6Addresses.push(address.address);
      }
    }
  }

  return ipv6Addresses;
};
exports.getIPv4Address = (): string[] =>
{
  const networkInterfaces = os.networkInterfaces();
  const ipv4Addresses: string[] = [];

  for (const interfaceKey in networkInterfaces)
  {
    const interfaces = networkInterfaces[interfaceKey];
    for (let i = 0; i < interfaces.length; i++)
    {
      const address = interfaces[i];
      if (address.family === 'IPv4' && !address.internal)
      {
        ipv4Addresses.push(address.address);
      }
    }
  }

  return ipv4Addresses;
};
