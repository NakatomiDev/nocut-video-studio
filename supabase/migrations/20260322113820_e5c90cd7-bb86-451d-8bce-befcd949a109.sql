-- Delete stale mock AI fills for project 02e17d05-7d08-4640-810a-60cb10b371cb
DELETE FROM ai_fills WHERE id = '6e33a240-b14b-4e94-b197-ec74d864d93c';

-- Delete the associated edit decision  
DELETE FROM edit_decisions WHERE id = '2f3d8be4-ce24-4a33-9f2b-d58b98577a9b';

-- Reset project status back to ready
UPDATE projects SET status = 'ready', error_message = NULL WHERE id = '02e17d05-7d08-4640-810a-60cb10b371cb';