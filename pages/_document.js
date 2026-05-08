// pages/_document.js
import { Html, Head, Main, NextScript } from "next/document";

const themeScript = `
(function(){
  try {
    var k='census-bot-theme';
    var t=localStorage.getItem(k);
    if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);return;}
    document.documentElement.setAttribute('data-theme','light');
  }catch(e){}
})();
`;

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Source+Sans+3:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
