import { useEffect, useState } from 'react';

/**
 * Hook to detect page visibility changes
 * Returns true when page is visible, false when hidden
 */
export function usePageVisibility(): boolean {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsVisible(!document.hidden);
        };

        // Set initial state
        setIsVisible(!document.hidden);

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    return isVisible;
}
