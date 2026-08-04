//utility.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//서버 네트워크 인터페이스 조회 관련.
//로직/주석은 원본과 동일 (동작 변경 없음).

const os = require('os');

exports.getIPv6Address = () => 
{
  const networkInterfaces = os.networkInterfaces();
  const ipv6Addresses = [];

  for (const interfaceKey in networkInterfaces) 
  {
    const interfaces = networkInterfaces[interfaceKey];
    for (let i = 0; i < interfaces.length; i++) 
    {
      const address = interfaces[i];
      if (address.family === 'IPv6' && !address.internal) 
      {
        ipv6Addresses.push(address.address);
      }
    }
  }

  return ipv6Addresses;
};
exports.getIPv4Address = () => 
{
  const networkInterfaces = os.networkInterfaces();
  const ipv4Addresses = [];

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
